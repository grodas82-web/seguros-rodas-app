/**
 * Cliente directo AFIP - Sin intermediarios
 * Implementa WSAA (autenticación) + WSFEv1 (facturación electrónica)
 */
const forge = require('node-forge');
const axios = require('axios');
const https = require('https');
const fs   = require('fs');
const path = require('path');

// AFIP usa servidores legacy — agente HTTPS compatible con Electron 40 / BoringSSL
const afipAgent = new https.Agent({
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3'
});

class AfipDirectClient {
    constructor(options = {}) {
        this.cuit       = String(options.cuit);
        this.certPem    = options.cert;
        this.keyPem     = options.key;
        this.production = options.production !== false;
        this.taFolder   = options.ta_folder || './afip_ta';

        if (!fs.existsSync(this.taFolder)) fs.mkdirSync(this.taFolder, { recursive: true });

        this.wsaaUrl = this.production
            ? 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
            : 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';

        this.wsfeUrl = this.production
            ? 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'
            : 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx';
    }

    // ─── WSAA ────────────────────────────────────────────────────────────────

    _toISOLocal(date) {
        // Convierte a hora Argentina (UTC-3) con offset correcto
        const offset = -3 * 60;
        const local  = new Date(date.getTime() + offset * 60_000);
        return local.toISOString().slice(0, 19) + '-03:00';
    }

    _buildTRA(service) {
        const now     = new Date();
        const genTime = this._toISOLocal(new Date(now.getTime() - 60_000));
        const expTime = this._toISOLocal(new Date(now.getTime() + 43_200_000));
        const uid     = Math.floor(now.getTime() / 1000);
        return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uid}</uniqueId><generationTime>${genTime}</generationTime><expirationTime>${expTime}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
    }

    _signTRA(traXml) {
        const p7 = forge.pkcs7.createSignedData();
        p7.content = forge.util.createBuffer(traXml, 'utf8');
        p7.addCertificate(this.certPem);
        p7.addSigner({
            key:       forge.pki.privateKeyFromPem(this.keyPem),
            certificate: forge.pki.certificateFromPem(this.certPem),
            digestAlgorithm: forge.pki.oids.sha256,
            authenticatedAttributes: []
        });
        p7.sign({ detached: false });
        const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
        return Buffer.from(der, 'binary').toString('base64');
    }

    async _getToken(service = 'wsfe') {
        const taFile = path.join(this.taFolder, `TA-${this.cuit}-${service}-direct.json`);

        // Usar token cacheado si no expiró (con 5 min de margen)
        if (fs.existsSync(taFile)) {
            try {
                const ta = JSON.parse(fs.readFileSync(taFile, 'utf8'));
                if (new Date(ta.expiration) > new Date(Date.now() + 300_000)) {
                    console.log('📋 Token cacheado válido, reutilizando...');
                    return { token: ta.token, sign: ta.sign };
                }
            } catch (_) {}
        }

        console.log('🔐 Obteniendo nuevo token WSAA...');
        const tra  = this._buildTRA(service);
        const cms  = this._signTRA(tra);

        const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cms}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;

        let res;
        try {
            res = await axios.post(this.wsaaUrl, soapBody, {
                headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': '' },
                httpsAgent: afipAgent,
                timeout: 30000
            });
        } catch (axErr) {
            const body = axErr.response?.data || axErr.message;
            console.error('❌ WSAA HTTP Error:', axErr.response?.status, body);
            throw new Error(`WSAA falló: ${JSON.stringify(body).substring(0, 500)}`);
        }

        // La respuesta viene HTML-encoded dentro de <loginCmsReturn>
        const rawXml = res.data;
        const innerEncoded = this._extract(rawXml, 'loginCmsReturn');
        if (!innerEncoded) throw new Error('WSAA: no se encontró loginCmsReturn en respuesta');

        // Decodificar HTML entities
        const xml = innerEncoded
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
            .replace(/&apos;/g, "'");

        const token      = this._extract(xml, 'token');
        const sign       = this._extract(xml, 'sign');
        const expiration = this._extract(xml, 'expirationTime');

        if (!token || !sign) {
            console.error('WSAA respuesta completa:', xml.substring(0, 1000));
            throw new Error('WSAA no devolvió token/sign');
        }

        fs.writeFileSync(taFile, JSON.stringify({ token, sign, expiration }), 'utf8');
        console.log('✅ Token WSAA obtenido, expira:', expiration);
        return { token, sign };
    }

    // ─── WSFEv1 helpers ──────────────────────────────────────────────────────

    _extract(xml, tag) {
        // match <tag> OR <prefix:tag>
        const regex = new RegExp(`<(?:[^>:]+:)?${tag}>([\\s\\S]*?)<\\/(?:[^>:]+:)?${tag}>`);
        const m = xml.match(regex);
        return m ? m[1].trim() : null;
    }

    _authBlock(token, sign) {
        return `<ar:Auth>
          <ar:Token>${token}</ar:Token>
          <ar:Sign>${sign}</ar:Sign>
          <ar:Cuit>${this.cuit}</ar:Cuit>
        </ar:Auth>`;
    }

    async _wsfeCall(action, body) {
        const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>${body}</soapenv:Body>
</soapenv:Envelope>`;

        const res = await axios.post(this.wsfeUrl, soap, {
            headers: {
                'Content-Type': 'text/xml; charset=UTF-8',
                'SOAPAction':   `http://ar.gov.afip.dif.FEV1/${action}`
            },
            httpsAgent: afipAgent,
            timeout: 30000
        });
        return res.data;
    }

    _checkErrors(xml) {
        const errMatch = xml.match(/<Err><Code>(\d+)<\/Code><Msg>([\s\S]*?)<\/Msg><\/Err>/);
        if (errMatch) throw new Error(`AFIP Error (${errMatch[1]}) ${errMatch[2]}`);
    }

    // ─── API pública ─────────────────────────────────────────────────────────

    async getServerStatus() {
        const xml = await this._wsfeCall('FEDummy', '<ar:FEDummy/>');
        return {
            AppServer: this._extract(xml, 'AppServer'),
            DbServer:  this._extract(xml, 'DbServer'),
            AuthServer: this._extract(xml, 'AuthServer')
        };
    }

    async getLastVoucher(pos, type) {
        const { token, sign } = await this._getToken();
        const xml = await this._wsfeCall('FECompUltimoAutorizado', `
          <ar:FECompUltimoAutorizado>
            ${this._authBlock(token, sign)}
            <ar:PtoVta>${parseInt(pos)}</ar:PtoVta>
            <ar:CbteTipo>${parseInt(type)}</ar:CbteTipo>
          </ar:FECompUltimoAutorizado>`);

        this._checkErrors(xml);
        const cbteNro = parseInt(this._extract(xml, 'CbteNro') || '0');

        const logLine = `[${new Date().toISOString()}] FECompUltimoAutorizado PtoVta=${pos} CbteTipo=${type} → CbteNro=${cbteNro}\nXML: ${xml.substring(0, 1200)}\n---\n`;
        try { fs.appendFileSync(path.join(__dirname, 'afip_lastVoucher_debug.log'), logLine); } catch(_) {}
        console.log(`📊 AFIP FECompUltimoAutorizado → próximo será: ${cbteNro + 1}`);
        return cbteNro;
    }

    async getSalesPoints() {
        const { token, sign } = await this._getToken();
        const xml = await this._wsfeCall('FEParamGetPtosVenta', `
          <ar:FEParamGetPtosVenta>
            ${this._authBlock(token, sign)}
          </ar:FEParamGetPtosVenta>`);
        return xml;
    }

    async createInvoice(data) {
        const { token, sign } = await this._getToken();

        const pos          = parseInt(data.pointOfSale);
        const typeId       = parseInt(data.typeId);
        const voucherNum   = parseInt(data.number);
        const concept      = parseInt(data.concept) || 1;
        const docType      = parseInt(data.docType  || 99);
        const docNro       = data.cuit ? parseInt(String(data.cuit).replace(/\D/g, '')) : 0;
        const date         = parseInt(data.date.replace(/-/g, ''));
        const impTotal     = parseFloat(data.amount).toFixed(2);
        const condIVA      = parseInt(data.ivaConditionId || 5);

        // Campos de servicio (Concepto 2 o 3)
        let serviceDates = '';
        if (concept === 2 || concept === 3) {
            const from = parseInt((data.serviceFrom || data.date).replace(/-/g, ''));
            const to   = parseInt((data.serviceTo   || data.date).replace(/-/g, ''));
            const due  = parseInt((data.paymentDue  || data.date).replace(/-/g, ''));
            serviceDates = `
            <ar:FchServDesde>${from}</ar:FchServDesde>
            <ar:FchServHasta>${to}</ar:FchServHasta>
            <ar:FchVtoPago>${due}</ar:FchVtoPago>`;
        }

        // Comprobantes asociados (solo para Notas de Crédito/Débito — tipos 3, 8, 13)
        // Si data.cbteAsoc no viene, este bloque es vacío y el XML queda idéntico al de facturas normales.
        let cbteAsocBlock = '';
        if (data.cbteAsoc && data.cbteAsoc.nro) {
            const asocTipo  = parseInt(data.cbteAsoc.tipo);
            const asocPtoV  = parseInt(data.cbteAsoc.ptovta);
            const asocNro   = parseInt(data.cbteAsoc.nro);
            const asocCuit  = String(this.cuit); // CUIT del emisor original (nosotros)
            cbteAsocBlock = `
                  <ar:CbtesAsoc>
                    <ar:CbteAsoc>
                      <ar:Tipo>${asocTipo}</ar:Tipo>
                      <ar:PtoVta>${asocPtoV}</ar:PtoVta>
                      <ar:Nro>${asocNro}</ar:Nro>
                      <ar:Cuit>${asocCuit}</ar:Cuit>
                    </ar:CbteAsoc>
                  </ar:CbtesAsoc>`;
            console.log(`🔗 CbtesAsoc: Tipo=${asocTipo} PtoVta=${asocPtoV} Nro=${asocNro} Cuit=${asocCuit}`);
        }

        console.log(`🌐 WSFE URL: ${this.wsfeUrl}`);
        console.log(`🌐 WSAA URL: ${this.wsaaUrl}`);
        console.log(`📋 Datos enviados: PtoVta=${pos} CbteTipo=${typeId} CbteNro=${voucherNum} DocNro=${docNro} ImpTotal=${impTotal} concept=${concept} condIVA=${condIVA}`);

        const xml = await this._wsfeCall('FECAESolicitar', `
          <ar:FECAESolicitar>
            ${this._authBlock(token, sign)}
            <ar:FeCAEReq>
              <ar:FeCabReq>
                <ar:CantReg>1</ar:CantReg>
                <ar:PtoVta>${pos}</ar:PtoVta>
                <ar:CbteTipo>${typeId}</ar:CbteTipo>
              </ar:FeCabReq>
              <ar:FeDetReq>
                <ar:FECAEDetRequest>
                  <ar:Concepto>${concept}</ar:Concepto>
                  <ar:DocTipo>${docType}</ar:DocTipo>
                  <ar:DocNro>${docNro}</ar:DocNro>
                  <ar:CbteDesde>${voucherNum}</ar:CbteDesde>
                  <ar:CbteHasta>${voucherNum}</ar:CbteHasta>
                  <ar:CbteFch>${date}</ar:CbteFch>
                  <ar:ImpTotal>${impTotal}</ar:ImpTotal>
                  <ar:ImpTotConc>0.00</ar:ImpTotConc>
                  <ar:ImpNeto>${impTotal}</ar:ImpNeto>
                  <ar:ImpOpEx>0.00</ar:ImpOpEx>
                  <ar:ImpIVA>0.00</ar:ImpIVA>
                  <ar:ImpTrib>0.00</ar:ImpTrib>${serviceDates}${cbteAsocBlock}
                  <ar:MonId>PES</ar:MonId>
                  <ar:MonCotiz>1</ar:MonCotiz>
                  <ar:CondicionIVAReceptorId>${condIVA}</ar:CondicionIVAReceptorId>
                </ar:FECAEDetRequest>
              </ar:FeDetReq>
            </ar:FeCAEReq>
          </ar:FECAESolicitar>`);

        console.log(`📨 Respuesta AFIP RAW (primeros 2000 chars):\n${xml.substring(0, 2000)}`);

        this._checkErrors(xml);

        const cae        = this._extract(xml, 'CAE');
        const caeExpiry  = this._extract(xml, 'CAEFchVto');
        const resultado  = this._extract(xml, 'Resultado');
        const obs        = xml.match(/<Obs><Code>(\d+)<\/Code><Msg>([\s\S]*?)<\/Msg><\/Obs>/);

        if (!cae || resultado === 'R') {
            const obsMsg = obs ? `Obs ${obs[1]}: ${obs[2]}` : 'Sin CAE en respuesta';
            throw new Error('AFIP rechazó la factura: ' + obsMsg);
        }

        // Formatear fecha vencimiento CAE
        const caeFormatted = caeExpiry
            ? `${caeExpiry.slice(0,4)}-${caeExpiry.slice(4,6)}-${caeExpiry.slice(6,8)}`
            : null;

        console.log(`✅ CAE REAL obtenido: ${cae} - Vence: ${caeFormatted}`);

        // Verificar inmediatamente que quedó guardada en AFIP
        try {
            const verXml = await this._wsfeCall('FECompConsultar', `
              <ar:FECompConsultar>
                ${this._authBlock(token, sign)}
                <ar:FeCompConsReq>
                  <ar:CbteTipo>${typeId}</ar:CbteTipo>
                  <ar:CbteNro>${voucherNum}</ar:CbteNro>
                  <ar:PtoVta>${pos}</ar:PtoVta>
                </ar:FeCompConsReq>
              </ar:FECompConsultar>`);
            const verCAE = this._extract(verXml, 'CAE');
            const verResultado = this._extract(verXml, 'Resultado');
            console.log(`🔍 VERIFICACION FECompConsultar: CAE=${verCAE} Resultado=${verResultado}`);
            console.log(`🔍 VERIFICACION RAW:`, verXml.substring(0, 800));
        } catch(verErr) {
            console.error('❌ Verificación FECompConsultar falló:', verErr.message);
        }

        return { success: true, cae, caeExpiration: caeFormatted, number: data.number };
    }
}

module.exports = AfipDirectClient;
