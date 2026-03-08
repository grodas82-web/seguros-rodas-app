import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

function analyzeGaps() {
    const csvContent = fs.readFileSync(path.join(process.cwd(), 'scripts', 'all_found_invoices.csv'), 'utf-8');
    const records = parse(csvContent, { columns: true, skip_empty_lines: true });

    const sequenceMap = {}; // POS -> Set of numbers

    records.forEach(r => {
        const name = r.Name;
        const parts = name.split('_');
        if (parts.length >= 4) {
            const pos = parts[2].padStart(5, '0');
            const num = parseInt(parts[3].replace('.pdf', '').split(' ')[0]);

            // FILTRO: Ignorar números sospechosos (ej: fechas como 07092025)
            // Una secuencia normal no debería saltar a millones de golpe.
            if (!isNaN(num) && num > 0 && num < 1000000) {
                if (!sequenceMap[pos]) sequenceMap[pos] = new Set();
                sequenceMap[pos].add(num);
            }
        }
    });

    const results = [];

    for (const pos in sequenceMap) {
        const nums = Array.from(sequenceMap[pos]).sort((a, b) => a - b);
        const max = nums[nums.length - 1];
        const gaps = [];

        for (let i = 1; i < max; i++) {
            if (!sequenceMap[pos].has(i)) {
                gaps.push(i.toString().padStart(8, '0'));
            }
        }

        results.push({
            pos,
            min: nums[0]?.toString().padStart(8, '0'),
            max: max?.toString().padStart(8, '0'),
            totalFound: nums.length,
            gapsCount: gaps.length,
            gaps: gaps
        });
    }

    fs.writeFileSync(path.join(process.cwd(), 'scripts', 'sequence_gaps.json'), JSON.stringify(results, null, 2));
    console.log("Gap analysis saved to sequence_gaps.json");

    results.forEach(r => {
        console.log(`POS ${r.pos}: Found ${r.totalFound} docs. Range: ${r.min} - ${r.max}. Gaps: ${r.gapsCount}`);
        if (r.gaps.length > 0) {
            console.log(`  Next Gaps: ${r.gaps.slice(0, 5).join(', ')}...`);
        }
    });
}

analyzeGaps();
