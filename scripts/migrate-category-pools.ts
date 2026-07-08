// One-off: copy CategoryPool rows from the sdc_standard_fees database into
// this app's sdc_etc_planner database (same MySQL instance, same user), so the
// Standard Sheet tab's Standard Fees columns have real pool data behind them.
// Idempotent — upserts on (category, month).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SourceRow = {
  category: "ENGINEERING_PM" | "ENGINEERING_WARRANTY" | "SHOP_MANUFACTURING" | "SHOP_WARRANTY";
  month: string;
  previousMonthPulledHours: string;
  newHoursAddedThisMonth: string;
  hoursAvailable: string;
  hoursWorkedThisMonth: string;
  hoursPulledThisMonth: string;
  newEtcHours: string;
  rate: string;
  standardFee: string;
  source: string;
};

async function main() {
  const rows = await prisma.$queryRawUnsafe<SourceRow[]>(
    `SELECT category, month, previousMonthPulledHours, newHoursAddedThisMonth,
            hoursAvailable, hoursWorkedThisMonth, hoursPulledThisMonth,
            newEtcHours, rate, standardFee, source
     FROM sdc_standard_fees.CategoryPool`
  );
  console.log(`Source rows in sdc_standard_fees.CategoryPool: ${rows.length}`);

  for (const r of rows) {
    await prisma.categoryPool.upsert({
      where: { category_month: { category: r.category, month: r.month } },
      update: {
        previousMonthPulledHours: r.previousMonthPulledHours,
        newHoursAddedThisMonth: r.newHoursAddedThisMonth,
        hoursAvailable: r.hoursAvailable,
        hoursWorkedThisMonth: r.hoursWorkedThisMonth,
        hoursPulledThisMonth: r.hoursPulledThisMonth,
        newEtcHours: r.newEtcHours,
        rate: r.rate,
        standardFee: r.standardFee,
        source: "migration",
      },
      create: {
        category: r.category,
        month: r.month,
        previousMonthPulledHours: r.previousMonthPulledHours,
        newHoursAddedThisMonth: r.newHoursAddedThisMonth,
        hoursAvailable: r.hoursAvailable,
        hoursWorkedThisMonth: r.hoursWorkedThisMonth,
        hoursPulledThisMonth: r.hoursPulledThisMonth,
        newEtcHours: r.newEtcHours,
        rate: r.rate,
        standardFee: r.standardFee,
        source: "migration",
      },
    });
    console.log(`  upserted ${r.month} ${r.category}: fee=${r.standardFee}`);
  }

  const check = await prisma.categoryPool.findMany({ orderBy: [{ month: "asc" }, { category: "asc" }] });
  console.log(`\nDestination now has ${check.length} rows:`);
  for (const c of check) {
    console.log(`  ${c.month} ${c.category}: available=${c.hoursAvailable} rate=${c.rate} fee=${c.standardFee}`);
  }
}

main().finally(() => prisma.$disconnect());
