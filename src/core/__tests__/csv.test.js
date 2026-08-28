import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeField, neutraliseFormula, toCsv, buildForm8949Csv, buildAuditCsv } from '../csv.js';
import { calculateGains } from '../gains.js';

/** Built from its code point so no invisible character sits in this source. */
const BOM = String.fromCodePoint(0xfeff);
const noBom = (text) => (text.startsWith(BOM) ? text.slice(1) : text);

/**
 * A UTXO label goes straight into the export. If it begins with a formula
 * character, opening the report in Excel used to execute it.
 */
test('neutralises spreadsheet formula injection', () => {
    assert.equal(neutraliseFormula('=1+1'), "'=1+1");
    assert.equal(neutraliseFormula('@SUM(A1:A9)'), "'@SUM(A1:A9)");
    assert.equal(neutraliseFormula('+cmd|calc'), "'+cmd|calc");
    assert.equal(neutraliseFormula('-2+3+cmd'), "'-2+3+cmd");
});

test('genuine numbers and dates are left alone so they still import as values', () => {
    assert.equal(neutraliseFormula('-123.45'), '-123.45');
    assert.equal(neutraliseFormula('0.00'), '0.00');
    assert.equal(neutraliseFormula('2023-01-01'), '2023-01-01');
});

test('quotes fields per RFC 4180', () => {
    assert.equal(escapeField('plain'), 'plain');
    assert.equal(escapeField('has,comma'), '"has,comma"');
    assert.equal(escapeField('has"quote'), '"has""quote"');
    assert.equal(escapeField('two\nlines'), '"two\nlines"');
    assert.equal(escapeField(' padded '), '" padded "');
    assert.equal(escapeField(null), '');
    assert.equal(escapeField(undefined), '');
});

test('strips control characters that would corrupt the row', () => {
    assert.equal(escapeField(`a${String.fromCodePoint(0x07)}b`), 'ab');
    assert.equal(escapeField(`a${String.fromCodePoint(0x00)}b`), 'ab');
});

test('a label containing a comma no longer breaks the column layout', () => {
    const csv = noBom(toCsv(['a', 'b'], [['Cold storage, do not spend', '1.00']]));
    const [, dataLine] = csv.trim().split('\r\n');

    assert.equal(dataLine, '"Cold storage, do not spend",1.00');
});

test('rows are CRLF terminated and carry a BOM by default', () => {
    const csv = toCsv(['a'], [['1']]);
    assert.ok(csv.startsWith(BOM), 'Excel needs the BOM to read UTF-8');
    assert.ok(csv.endsWith('\r\n'));
    assert.ok(!toCsv(['a'], [['1']], { bom: false }).startsWith(BOM));
});

const auditFixture = () => calculateGains([
    { id: 'b1', type: 'BUY', date: '2022-01-01', amount: '1.0', price: '50000' },
    { id: 's1', type: 'SELL', date: '2023-06-01', amount: '1.0', price: '40000' },
    { id: 'b2', type: 'BUY', date: '2023-06-10', amount: '1.0', price: '42000' },
    { id: 'b3', type: 'BUY', date: '2023-07-01', amount: '1.0', price: '30000' },
    { id: 's2', type: 'SELL', date: '2023-08-01', amount: '1.0', price: '45000' },
], { method: 'FIFO', applyWashSale: true });

test('the 8949 export carries the columns the form actually needs', () => {
    const { disposals } = auditFixture();
    const lines = noBom(buildForm8949Csv(disposals)).trim().split('\r\n');
    const headers = lines[0].split(',');

    assert.ok(headers[2].includes('Date acquired'));
    assert.ok(headers[3].includes('Date sold'));

    // The date acquired column used to be hardcoded to "N/A" on every row.
    for (const line of lines.slice(1)) {
        const columns = line.split(',');
        assert.match(columns[2], /^\d{4}-\d{2}-\d{2}$/, `date acquired present: ${line}`);
        assert.ok(columns[0] === 'Short' || columns[0] === 'Long', 'term is classified');
    }
});

test('a wash sale is reported with code W and a positive adjustment', () => {
    const { disposals } = auditFixture();
    const washed = disposals.find((disposal) => disposal.washSale);
    assert.ok(washed, 'the fixture contains a wash sale');

    const rows = noBom(buildForm8949Csv(disposals)).trim().split('\r\n').slice(1);
    const washRow = rows.find((row) => row.split(',')[6] === 'W');

    assert.ok(washRow, 'a row carries the W adjustment code');
    assert.equal(washRow.split(',')[7], '10000.00', 'the disallowed loss is the adjustment');
});

test('the wash sale column no longer emits raw booleans', () => {
    const { disposals } = auditFixture();
    const csv = buildAuditCsv(disposals);

    assert.ok(!csv.includes(',true,'));
    assert.ok(!csv.includes(',false,'));
    assert.ok(csv.includes('Yes') || csv.includes('No'));
});

test('the working paper export includes user annotations, safely escaped', () => {
    const { disposals } = auditFixture();
    const csv = noBom(buildAuditCsv(disposals, {
        labels: { 'lot:b1': '=HYPERLINK("http://evil","click")' },
        notes: { s1: 'Sold, at a loss' },
    }));

    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`), 'formula neutralised and quoted');
    assert.ok(csv.includes('"Sold, at a loss"'), 'comma-bearing note is quoted');
});
