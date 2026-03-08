$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    # Save Sheet 3 (Facturas) as CSV
    $sFact = $workbook.Sheets.Item(3)
    $sFact.SaveAs("c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\facturas.csv", 6)
    
    # Save Sheet 4 (Cuit) as CSV
    $sCuit = $workbook.Sheets.Item(4)
    $sCuit.SaveAs("c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\cuits.csv", 6)
    
    $workbook.Close($false)
    Write-Host "CSVs saved successfully."
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
