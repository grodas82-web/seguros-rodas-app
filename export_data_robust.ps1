$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    $data = [PSCustomObject]@{
        companies = @()
        invoices  = @()
    }
    
    foreach ($s in $workbook.Sheets) {
        if ($s.Name -eq "Cuit") {
            Write-Host "Found Cuit sheet..."
            for ($r = 4; $r -le 500; $r++) {
                $name = $s.Cells.Item($r, 1).Text
                if ($name -and $name.Trim() -ne "") {
                    $data.companies += @{
                        name    = $name.Trim()
                        cuit    = $s.Cells.Item($r, 2).Text.Trim()
                        ivaType = $s.Cells.Item($r, 3).Text.Trim()
                    }
                }
            }
        }
        if ($s.Name -eq "Facturas") {
            Write-Host "Found Facturas sheet..."
            for ($r = 4; $r -le 2000; $r++) {
                $num = $s.Cells.Item($r, 1).Text
                if ($num -and $num.Trim() -ne "") {
                    $totVal = $s.Cells.Item($r, 4).Text
                    $cleanTot = $totVal -replace '[^\d,.-]', ''
                    if ($cleanTot -like "*,*") {
                        # Change dots to nothing and comma to dot for conversion
                        $cleanTot = $cleanTot -replace '\.', '' -replace ',', '.'
                    }
                    $amt = 0.0
                    if ($cleanTot -as [double]) { $amt = $cleanTot -as [double] }
                    
                    $data.invoices += @{
                        number      = $num.Trim()
                        date        = $s.Cells.Item($r, 2).Text.Trim()
                        company     = $s.Cells.Item($r, 3).Text.Trim()
                        amount      = $amt
                        type        = "Factura A"
                        pointOfSale = "0001"
                        cuit        = ""
                    }
                }
            }
        }
    }
    
    $data | ConvertTo-Json -Depth 10 | Out-File -FilePath "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\migration_data.json" -Encoding UTF8
    Write-Host "Done. Data saved."
    
    $workbook.Close($false)
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
