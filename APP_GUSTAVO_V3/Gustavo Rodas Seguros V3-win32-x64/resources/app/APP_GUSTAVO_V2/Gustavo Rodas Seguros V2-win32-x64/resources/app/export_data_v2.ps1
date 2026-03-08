$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AutomationSecurity = 3

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    $shCuit = $null
    $shFacturas = $null
    
    foreach ($s in $workbook.Sheets) {
        if ($s.Name -like "*Cuit*") { $shCuit = $s }
        if ($s.Name -like "*Facturas*") { $shFacturas = $s }
    }
    
    $data = @{
        companies = @()
        invoices  = @()
    }
    
    if ($shCuit) {
        # Header starts at row 3 (Compañías, Cuit, Tipo de Iva)
        for ($r = 4; $r -le 200; $r++) {
            $name = $shCuit.Cells.Item($r, 1).Text
            $cuitVal = $shCuit.Cells.Item($r, 2).Text
            $iva = $shCuit.Cells.Item($r, 3).Text
            if ($name -and $name.Trim() -ne "") {
                $data.companies += @{
                    name    = $name
                    cuit    = $cuitVal
                    ivaType = $iva
                }
            }
        }
    }
    
    if ($shFacturas) {
        if ($shFacturas.ListObjects.Count -gt 0) {
            $tbl = $shFacturas.ListObjects.Item(1)
            foreach ($row in $tbl.ListRows) {
                $comp = $row.Range.Cells.Item(1, 1).Value
                $cuit = $row.Range.Cells.Item(1, 2).Value
                $tipo = $row.Range.Cells.Item(1, 3).Value
                $pve = $row.Range.Cells.Item(1, 4).Value
                $num = $row.Range.Cells.Item(1, 5).Value
                $tot = $row.Range.Cells.Item(1, 6).Value
                $fec = $row.Range.Cells.Item(1, 7).Text
                
                if ($comp) {
                    $data.invoices += @{
                        company     = [string]$comp
                        cuit        = [string]$cuit
                        type        = [string]$tipo
                        pointOfSale = [string]$pve
                        number      = [string]$num
                        amount      = [double]$tot
                        date        = $fec
                    }
                }
            }
        }
    }
    
    $data | ConvertTo-Json -Depth 10 | Out-File -FilePath "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\migration_data.json" -Encoding UTF8
    
    $workbook.Close($false)
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
