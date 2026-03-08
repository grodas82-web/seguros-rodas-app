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
    
    # Use Indices from Diagnostic: 3=Facturas, 4=Cuit
    Write-Host "Reading Table 4 (Cuit)..."
    $sCuit = $workbook.Sheets.Item(4)
    for ($r = 4; $r -le 300; $r++) {
        $name = $sCuit.Cells.Item($r, 1).Text
        if ($name -and $name.Trim() -ne "") {
            $data.companies += @{
                name    = $name.Trim()
                cuit    = $sCuit.Cells.Item($r, 2).Text.Trim()
                ivaType = $sCuit.Cells.Item($r, 3).Text.Trim()
            }
        }
    }
    
    Write-Host "Reading Table 3 (Facturas)..."
    $sFact = $workbook.Sheets.Item(3)
    for ($r = 4; $r -le 2000; $r++) {
        $num = $sFact.Cells.Item($r, 1).Text
        if ($num -and $num.Trim() -ne "") {
            $totVal = $sFact.Cells.Item($r, 4).Text
            $cleanTot = $totVal -replace '[^\d,.-]', ''
            if ($cleanTot -like "*,*") {
                $cleanTot = $cleanTot -replace '\.', '' -replace ',', '.'
            }
            $amt = 0.0
            if ($cleanTot -as [double]) { $amt = $cleanTot -as [double] }
            
            $data.invoices += @{
                number      = $num.Trim()
                date        = $sFact.Cells.Item($r, 2).Text.Trim()
                company     = $sFact.Cells.Item($r, 3).Text.Trim()
                amount      = $amt
                type        = "Factura A"
                pointOfSale = "0001"
            }
        }
    }
    
    $data | ConvertTo-Json -Depth 10 | Out-File -FilePath "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\migration_data.json" -Encoding UTF8
    Write-Host "Saved $($data.invoices.Count) invoices and $($data.companies.Count) companies."
    
    $workbook.Close($false)
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
