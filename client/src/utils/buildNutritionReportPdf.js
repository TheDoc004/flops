import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { computePeriodStats, averageGoalCalories, goalVersionsForRange } from './reportStats';
import { formatTargetRangeDisplay } from './goalAdherence';

function fmt(n, d = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return d === 0 ? String(Math.round(n)) : n.toFixed(d);
}

function fmtGoalRange(key, min, max) {
  if (min == null && max == null) return '—';
  return formatTargetRangeDisplay(key, { min: min ?? max, max: max ?? min }, 'metric');
}

export function buildNutritionReportPdf({
  title,
  start,
  end,
  entries,
  goalsPayload,
  profile,
}) {
  const stats = computePeriodStats(entries, start, end);
  const avgGoalCal = averageGoalCalories(goalsPayload, start, end);
  const goalVersions = goalVersionsForRange(goalsPayload, start, end);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  let y = margin;

  doc.setFontSize(18);
  doc.text('NutriLog — nutrition report', margin, y);
  y += 28;
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(`${title}`, margin, y);
  y += 16;
  doc.text(`Period: ${start} to ${end} (${stats.periodDays} calendar days)`, margin, y);
  y += 22;

  doc.setTextColor(0);
  doc.setFontSize(12);
  doc.text('Summary (for coach / AI review)', margin, y);
  y += 14;
  doc.setFontSize(10);
  const blocks = [
    `Over ${stats.periodDays} calendar day(s), logged meals total about ${fmt(stats.totals.calories)} kcal (protein ${fmt(stats.totals.protein_g, 1)} g, carbs ${fmt(stats.totals.carbs_g, 1)} g, fat ${fmt(stats.totals.fat_g, 1)} g).`,
    `Average per calendar day: ~${fmt(stats.averages.calories)} kcal, protein ${fmt(stats.averages.protein_g, 1)} g, carbs ${fmt(stats.averages.carbs_g, 1)} g, fat ${fmt(stats.averages.fat_g, 1)} g.`,
    `${stats.daysWithEntries} day(s) included at least one logged meal.`,
  ];
  if (avgGoalCal != null) {
    blocks.push(
      avgGoalCal.min === avgGoalCal.max
        ? `Average calorie goal during this period: ~${fmt(avgGoalCal.min)} kcal/day.`
        : `Average calorie goal range during this period: ~${fmt(avgGoalCal.min)}–${fmt(avgGoalCal.max)} kcal/day.`
    );
  }
  blocks.forEach(paragraph => {
    doc.splitTextToSize(paragraph, 520).forEach(line => {
      doc.text(line, margin, y);
      y += 12;
    });
    y += 6;
  });
  y += 8;

  doc.setFontSize(12);
  doc.text('Period totals (from logged meals)', margin, y);
  y += 6;
  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Amount']],
    body: [
      ['Total calories', `${fmt(stats.totals.calories)} kcal`],
      ['Total protein', `${fmt(stats.totals.protein_g, 1)} g`],
      ['Total carbs', `${fmt(stats.totals.carbs_g, 1)} g`],
      ['Total fat', `${fmt(stats.totals.fat_g, 1)} g`],
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 10 },
    headStyles: { fillColor: [37, 99, 235] },
  });
  y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 24;

  if (stats.dailyRows.length > 0) {
    doc.setFontSize(12);
    doc.text('Daily intake (logged)', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Date', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)']],
      body: stats.dailyRows.map(d => [
        d.date,
        fmt(d.calories),
        fmt(d.protein_g, 1),
        fmt(d.carbs_g, 1),
        fmt(d.fat_g, 1),
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 24;
  }

  if (goalVersions.length > 0) {
    doc.setFontSize(12);
    doc.text('Goal versions used in this period', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Effective from', 'Day', 'Calories', 'P', 'C', 'F']],
      body: goalVersions.flatMap(version =>
        (version.goals || []).map(g => [
          version.effective_start_date || 'Current',
          g.label || String(g.weekday),
          fmtGoalRange('calories', g.calories_min, g.calories_max),
          fmtGoalRange('protein_g', g.protein_g_min, g.protein_g_max),
          fmtGoalRange('carbs_g', g.carbs_g_min, g.carbs_g_max),
          fmtGoalRange('fat_g', g.fat_g_min, g.fat_g_max),
        ])
      ),
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y) + 24;
  }

  if (profile && (profile.height_cm || profile.weight_kg || profile.age)) {
    doc.setFontSize(12);
    doc.text('Profile (optional)', margin, y);
    y += 6;
    autoTable(doc, {
      startY: y,
      head: [['Field', 'Value']],
      body: [
        ['Height (cm)', profile.height_cm != null ? fmt(profile.height_cm, 1) : '—'],
        ['Current weight (kg)', profile.weight_kg != null ? fmt(profile.weight_kg, 1) : '—'],
        ['Goal weight (kg)', profile.goal_weight_kg != null ? fmt(profile.goal_weight_kg, 1) : '—'],
        ['Age', profile.age != null ? String(profile.age) : '—'],
        ['Sex', profile.sex || '—'],
        ['Activity', profile.activity_level || '—'],
        ['Est. maintenance (kcal)', profile.maintenance_calories != null ? fmt(profile.maintenance_calories) : '—'],
      ],
      margin: { left: margin, right: margin },
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
    });
  }

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    'Generated by NutriLog. Macro and calorie totals come from your logged recipes and servings.',
    margin,
    doc.internal.pageSize.getHeight() - 36
  );

  return doc;
}

export function downloadReportPdf(blobTitle, doc) {
  doc.save(`nutrilog-report-${blobTitle}.pdf`);
}
