$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    foreach ($s in $workbook.Sheets) {
        Write-Host "Checking sheet: $($s.Name)"
        if ($s.Name -like "*Facturas*") {
            Write-Host "Exporting Facturas..."
            $s.SaveAs("c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\facturas.csv", 6)
        }
        if ($s.Name -like "*Cuit*") {
            Write-Host "Exporting Cuits..."
            $s.SaveAs("c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\cuits.csv", 6)
        }
    }
    
    $workbook.Close($false)
    Write-Host "Export finished."
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
