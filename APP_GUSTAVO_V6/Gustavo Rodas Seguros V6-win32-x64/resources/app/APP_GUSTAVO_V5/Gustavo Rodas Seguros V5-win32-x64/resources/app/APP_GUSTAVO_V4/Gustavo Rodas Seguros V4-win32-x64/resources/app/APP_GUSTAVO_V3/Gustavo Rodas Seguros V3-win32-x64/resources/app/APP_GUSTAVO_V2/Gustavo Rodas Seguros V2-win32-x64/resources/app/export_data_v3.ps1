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
    
    # Export Companies
    if ($shCuit) {
        for ($r = 4; $r -le 250; $r++) {
            $name = $shCuit.Cells.Item($r, 1).Text
            if ($name -and $name.Trim() -ne "") {
                $data.companies += @{
                    name    = $name
                    cuit    = $shCuit.Cells.Item($r, 2).Text
                    ivaType = $shCuit.Cells.Item($r, 3).Text
                }
            }
        }
    }
    
    # Export Invoices
    if ($shFacturas -and $shFacturas.ListObjects.Count -gt 0) {
        $tbl = $shFacturas.ListObjects.Item(1)
        foreach ($row in $tbl.ListRows) {
            $num = $row.Range.Cells.Item(1, 1).Text
            $fec = $row.Range.Cells.Item(1, 2).Text
            $comp = $row.Range.Cells.Item(1, 3).Text
            $tot = $row.Range.Cells.Item(1, 4).Text
            
            # Clean total (remove $, dots as thousand separators if necessary)
            $cleanTot = $tot -replace '[^\d,.-]', '' -replace '\.', '' -replace ',', '.'
            
            if ($comp -and $comp.Trim() -ne "") {
                $data.invoices += @{
                    company     = $comp
                    number      = $num
                    amount      = [double]$cleanTot
                    date        = $fec
                    type        = "Factura A" # Default
                    pointOfSale = "0001" # Default
                    cuit        = "" # Will be looked up during seeding or in UI
                }
            }
        }
    }
    
    $data | ConvertTo-Json -Depth 5 | Out-File -FilePath "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\migration_data.json" -Encoding UTF8
    
    $workbook.Close($false)
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
