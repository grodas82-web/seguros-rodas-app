$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$filePath = "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion 2026.xlsm"
$workbook = $excel.Workbooks.Open($filePath)

$output = "["

# 1. Export Companies from "Cuit" sheet
$shCuit = $workbook.Sheets.Item("Cuit")
$companies = @()
for ($r = 4; $r -le 100; $r++) {
    $name = $shCuit.Cells.Item($r, 1).Text
    $cuitVal = $shCuit.Cells.Item($r, 2).Text
    $iva = $shCuit.Cells.Item($r, 3).Text
    if ($name) {
        $companies += "@{`"name`":`"$name`", `"cuit`":`"$cuitVal`", `"ivaType`":`"$iva`"}"
    }
}

# 2. Export Invoices from "Facturas" table
$shFacturas = $workbook.Sheets.Item("Facturas")
$tbl = $shFacturas.ListObjects.Item("facturasIngresadas")
$invoices = @()
foreach ($row in $tbl.ListRows) {
    $comp = $row.Range.Cells.Item(1, 1).Value
    $cuit = $row.Range.Cells.Item(1, 2).Value
    $tipo = $row.Range.Cells.Item(1, 3).Value
    $pve = $row.Range.Cells.Item(1, 4).Value
    $num = $row.Range.Cells.Item(1, 5).Value
    $tot = $row.Range.Cells.Item(1, 6).Value
    $fec = $row.Range.Cells.Item(1, 7).Text
    
    if ($comp) {
        $invoices += "@{`"company`":`"$comp`", `"cuit`":`"$cuit`", `"type`":`"$tipo`", `"pointOfSale`":`"$pve`", `"number`":`"$num`", `"amount`":$tot, `"date`":`"$fec`"}"
    }
}

$finalJson = "{`"companies`": [" + ($companies -join ",") + "], `"invoices`": [" + ($invoices -join ",") + "]}"
# Powerhell custom to real JSON
$realJson = $finalJson -replace '@{', '{' -replace '" : "', '":"' -replace '}', '}' -replace '`"', '"'

$realJson | Out-File -FilePath "c:\Users\Admin\OneDrive\Escritorio\Proyecto Facturacion 2026\Facturacion-2026-App\src\migration_data.json" -Encoding UTF8

$workbook.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
