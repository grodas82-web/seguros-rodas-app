$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
    $filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
    $workbook = $excel.Workbooks.Open($filePath)
    
    Write-Host "--- WORKBOOK DIAGNOSTIC ---"
    foreach ($s in $workbook.Sheets) {
        Write-Host "SHEET: $($s.Name)"
        if ($s.ListObjects.Count -gt 0) {
            foreach ($lo in $s.ListObjects) {
                Write-Host "  TABLE: $($lo.Name)"
            }
        }
        for ($r = 1; $r -le 5; $r++) {
            $row = ""
            for ($c = 1; $c -le 8; $c++) {
                $val = $s.Cells.Item($r, $c).Text
                if ($val) { $row += "[$($val)] " }
            }
            if ($row) { Write-Host "    R$($r): $($row)" }
        }
    }
    Write-Host "--- END ---"
    
    $workbook.Close($false)
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
finally {
    $excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
