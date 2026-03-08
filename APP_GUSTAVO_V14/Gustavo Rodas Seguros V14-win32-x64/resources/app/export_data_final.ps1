$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AutomationSecurity = 3

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    $data = [PSCustomObject]@{
        companies = @()
        invoices  = @()
    }
    
    # 1. Cuit Sheet
    $shCuit = $workbook.Sheets.Item("Cuit")
    if ($shCuit) {
        Write-Host "Processing Cuit sheet..."
        for ($r = 4; $r -le 500; $r++) {
            $name = $shCuit.Cells.Item($r, 1).Text
            if ($name -and $name.Trim() -ne "") {
                $comp = [PSCustomObject]@{
                    name    = $name.Trim()
                    cuit    = $shCuit.Cells.Item($r, 2).Text.Trim()
                    ivaType = $shCuit.Cells.Item($r, 3).Text.Trim()
                }
                $data.companies += $comp
            }
        }
    }
    
    # 2. Facturas Sheet
    $shFacturas = $workbook.Sheets.Item("Facturas")
    if ($shFacturas) {
        Write-Host "Processing Facturas sheet..."
        # We know headers are at row 3
        for ($r = 4; $r -le 2000; $r++) {
            $num = $shFacturas.Cells.Item($r, 1).Text
            if ($num -and $num.Trim() -ne "") {
                $totVal = $shFacturas.Cells.Item($r, 4).Text
                $cleanTot = $totVal -replace '[^\d,.-]', ''
                if ($cleanTot -like "*,*") {
                    $cleanTot = $cleanTot -replace '\.', '' -replace ',', '.'
                }
                
                $inv = [PSCustomObject]@{
                    number      = $num.Trim()
                    date        = $shFacturas.Cells.Item($r, 2).Text.Trim()
                    company     = $shFacturas.Cells.Item($r, 3).Text.Trim()
                    amount      = [double]($cleanTot -as [double])
                    type        = "Factura A"
                    pointOfSale = "0001"
                    cuit        = ""
                }
                $data.invoices += $inv
            }
        }
    }
    
    Write-Host "Saving to JSON... (Invoices: $($data.invoices.Count), Companies: $($data.companies.Count))"
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
