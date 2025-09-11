#!/usr/bin/env node
// scripts/calc-cost-local.js
// Project monthly Neon cost from partial month usage data

const { program } = require('commander');

// Neon pricing constants (as of 2024)
const PRICING = {
  // Compute pricing per CU-hour
  COMPUTE_PER_CU_HOUR: 0.102, // $0.102 per CU-hour
  
  // Storage pricing per GB-month
  STORAGE_PER_GB_MONTH: 0.15, // $0.15 per GB-month
  
  // Data transfer pricing (Point-in-Time Recovery)
  PIT_PER_GB_MONTH: 0.14, // $0.14 per GB-month for PIT storage
  
  // Free tiers
  FREE_CU_HOURS: 750, // 750 CU-hours free per month
  FREE_STORAGE_GB: 0.5, // 0.5 GB storage free
  FREE_PIT_GB: 0.5 // 0.5 GB PIT storage free
};

program
  .name('calc-cost-local')
  .description('Calculate projected monthly Neon costs from partial usage')
  .requiredOption('--computeHours <hours>', 'compute hours used so far', parseFloat)
  .requiredOption('--day <day>', 'current day of month', parseInt)
  .option('--storage <gb>', 'storage GB used', parseFloat, 0)
  .option('--pit <gb>', 'point-in-time recovery storage GB', parseFloat, 0)
  .option('--daysInMonth <days>', 'total days in month', parseInt, 30)
  .option('--json', 'output as JSON')
  .option('--verbose', 'show detailed calculation')
  .parse();

const options = program.opts();

function calculateProjectedCost(computeHours, currentDay, storageGB, pitGB, daysInMonth) {
  // Project full month compute usage
  const dailyAverage = computeHours / currentDay;
  const projectedMonthlyCompute = dailyAverage * daysInMonth;
  
  // Calculate billable amounts (after free tier)
  const billableCompute = Math.max(0, projectedMonthlyCompute - PRICING.FREE_CU_HOURS);
  const billableStorage = Math.max(0, storageGB - PRICING.FREE_STORAGE_GB);
  const billablePit = Math.max(0, pitGB - PRICING.FREE_PIT_GB);
  
  // Calculate costs
  const computeCost = billableCompute * PRICING.COMPUTE_PER_CU_HOUR;
  const storageCost = billableStorage * PRICING.STORAGE_PER_GB_MONTH;
  const pitCost = billablePit * PRICING.PIT_PER_GB_MONTH;
  const totalCost = computeCost + storageCost + pitCost;
  
  return {
    input: {
      computeHours,
      currentDay,
      storageGB,
      pitGB,
      daysInMonth
    },
    projection: {
      dailyAverageCompute: dailyAverage,
      projectedMonthlyCompute,
      billableCompute,
      billableStorage,
      billablePit
    },
    costs: {
      compute: computeCost,
      storage: storageCost,
      pit: pitCost,
      total: totalCost
    },
    pricing: PRICING,
    freeTier: {
      computeUsed: Math.min(projectedMonthlyCompute, PRICING.FREE_CU_HOURS),
      computeRemaining: Math.max(0, PRICING.FREE_CU_HOURS - projectedMonthlyCompute),
      storageUsed: Math.min(storageGB, PRICING.FREE_STORAGE_GB),
      storageRemaining: Math.max(0, PRICING.FREE_STORAGE_GB - storageGB)
    }
  };
}

function main() {
  const result = calculateProjectedCost(
    options.computeHours,
    options.day,
    options.storage,
    options.pit,
    options.daysInMonth
  );
  
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  
  // Human-readable output
  console.log('Neon Cost Projection');
  console.log('====================');
  console.log();
  
  console.log('Input:');
  console.log(`  Compute hours used: ${result.input.computeHours.toFixed(2)}`);
  console.log(`  Current day: ${result.input.currentDay}`);
  console.log(`  Storage GB: ${result.input.storageGB.toFixed(3)}`);
  console.log(`  PIT GB: ${result.input.pitGB.toFixed(3)}`);
  console.log(`  Days in month: ${result.input.daysInMonth}`);
  console.log();
  
  console.log('Projection:');
  console.log(`  Daily average compute: ${result.projection.dailyAverageCompute.toFixed(2)} CU-hours/day`);
  console.log(`  Projected monthly compute: ${result.projection.projectedMonthlyCompute.toFixed(2)} CU-hours`);
  console.log();
  
  console.log('Free Tier Usage:');
  console.log(`  Compute: ${result.freeTier.computeUsed.toFixed(2)} / ${PRICING.FREE_CU_HOURS} CU-hours (${result.freeTier.computeRemaining.toFixed(2)} remaining)`);
  console.log(`  Storage: ${result.freeTier.storageUsed.toFixed(3)} / ${PRICING.FREE_STORAGE_GB} GB (${result.freeTier.storageRemaining.toFixed(3)} remaining)`);
  console.log();
  
  console.log('Billable Usage:');
  console.log(`  Compute: ${result.projection.billableCompute.toFixed(2)} CU-hours`);
  console.log(`  Storage: ${result.projection.billableStorage.toFixed(3)} GB`);
  console.log(`  PIT: ${result.projection.billablePit.toFixed(3)} GB`);
  console.log();
  
  console.log('Projected Costs:');
  console.log(`  Compute: $${result.costs.compute.toFixed(4)} (${result.projection.billableCompute.toFixed(2)} × $${PRICING.COMPUTE_PER_CU_HOUR})`);
  console.log(`  Storage: $${result.costs.storage.toFixed(4)} (${result.projection.billableStorage.toFixed(3)} × $${PRICING.STORAGE_PER_GB_MONTH})`);
  console.log(`  PIT: $${result.costs.pit.toFixed(4)} (${result.projection.billablePit.toFixed(3)} × $${PRICING.PIT_PER_GB_MONTH})`);
  console.log();
  console.log(`  TOTAL: $${result.costs.total.toFixed(2)}`);
  
  if (options.verbose) {
    console.log();
    console.log('Optimization Target:');
    const targetHours = 1.2 * result.input.daysInMonth; // ~1.2 CU-hours/day
    const targetCost = Math.max(0, targetHours - PRICING.FREE_CU_HOURS) * PRICING.COMPUTE_PER_CU_HOUR;
    console.log(`  Target: ${targetHours.toFixed(1)} CU-hours/month (~$${targetCost.toFixed(2)})`);
    console.log(`  Current projection: ${result.projection.projectedMonthlyCompute.toFixed(2)} CU-hours`);
    const reduction = ((result.projection.projectedMonthlyCompute - targetHours) / result.projection.projectedMonthlyCompute * 100);
    if (reduction > 0) {
      console.log(`  Reduction needed: ${reduction.toFixed(1)}%`);
    } else {
      console.log(`  ✓ Already under target by ${Math.abs(reduction).toFixed(1)}%`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { calculateProjectedCost, PRICING };