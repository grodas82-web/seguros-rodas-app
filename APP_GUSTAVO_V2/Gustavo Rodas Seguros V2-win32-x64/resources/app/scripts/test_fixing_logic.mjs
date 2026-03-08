
// Mocking the environment and required functions for testing fixInboundInvoice
const companies = [
    { name: 'MERCANTIL ANDINA', cuit: '30500036911' },
    { name: 'ZURICH', cuit: '30500049770' }
];

const normalizeName = (name) => {
    if (!name) return '';
    let n = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    n = n.toLowerCase()
        .replace(/s\.a\.|sa|compia|compañía|cia\.| \/|seg\.|argentina|nacion|asoc\.|mutual|asociacin|asociacion|riesgos|trabajo/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
    return n;
};

const fixInboundInvoice = (inv) => {
    const USER_CUIT = '23294824979';
    const USER_NAME = 'DIEGO GERMAN TRABALON';

    if (inv.cuit === USER_CUIT || !inv.company || inv.company.toUpperCase().includes(USER_NAME)) {
        let targetName = inv.company;
        if (!targetName || targetName.toUpperCase().includes(USER_NAME)) {
            const period = (inv.period || '').toUpperCase();
            if (period.includes('MERCANTIL')) targetName = 'MERCANTIL ANDINA';
            else if (period.includes('ZURICH')) targetName = 'ZURICH';
            else if (period.includes('RIVADAVIA')) targetName = 'RIVADAVIA';
        }

        if (targetName) {
            const normTarget = normalizeName(targetName);
            const targetComp = companies.find(c => normalizeName(c.name) === normTarget);
            if (targetComp && targetComp.cuit && targetComp.cuit !== USER_CUIT) {
                return { ...inv, company: targetComp.name, cuit: targetComp.cuit };
            }
        }
    }
    return inv;
};

// Test 1: AI incorrectly extracts Diego's name and CUIT, but period has 'MERCANTIL'
const test1 = {
    company: 'DIEGO GERMAN TRABALON',
    cuit: '23294824979',
    period: 'COMISIONES MERCANTIL ENERO 2026',
    amount: 1000,
    number: '00000001'
};

const result1 = fixInboundInvoice(test1);
console.log('Test 1 Result:', result1.company === 'MERCANTIL ANDINA' && result1.cuit === '30500036911' ? '✅ PASS' : '❌ FAIL');
if (result1.company !== 'MERCANTIL ANDINA' || result1.cuit !== '30500036911') {
    console.log('  Extracted:', result1.company, result1.cuit);
}

// Test 2: AI extracts Mercantil Andina name but Diego's CUIT
const test2 = {
    company: 'Mercantil Andina',
    cuit: '23294824979',
    amount: 2000,
    number: '00000002'
};

const result2 = fixInboundInvoice(test2);
console.log('Test 2 Result:', result2.company === 'MERCANTIL ANDINA' && result2.cuit === '30500036911' ? '✅ PASS' : '❌ FAIL');

// Test 3: Correct extraction
const test3 = {
    company: 'ZURICH',
    cuit: '30500049770',
    amount: 3000,
    number: '00000003'
};

const result3 = fixInboundInvoice(test3);
console.log('Test 3 Result:', result3.company === 'ZURICH' && result3.cuit === '30500049770' ? '✅ PASS' : '❌ FAIL');
