/**
 * Migration script: pricing_data.json → PostgreSQL
 * Creates PricingGroups, PricingCategories, PricingProfiles, PricingProfileCategories, PricingServices
 * Run: npx tsx scripts/migrate-pricing-to-db.ts
 */

import type { PrismaClient } from '@prisma/client'
import { makeScriptPrisma } from './_rls.mjs'
import * as fs from 'fs'
import * as path from 'path'

let prisma!: PrismaClient

const GROUP_ORDER = ['Tabia', 'AFI', 'Azmade', 'PMD', 'Novex', 'Azersheker', 'Separated']

const CATEGORY_MAP: Record<string, string[]> = {
  'Daimi İT xidməti': ['İT İnfrastruktur', 'Məlumat Bazası', 'Video, Monitorinq'],
  'İnfosec': ['İnformasiya Təhlükəsizlik', 'Təlim və Maarifləndirmə'],
  'Əlavə IT xidməti': ['HelpDesk və Texniki Dəstək'],
  'SAAS xidməti': ['Bulud Xidmətləri'],
  'ERP': ['Avtomatlaşdırılmış Sistemlər', 'SaaS Biznes Process'],
  'GRC': ['Audit və Uyğunluq'],
  'Layihə': ['Konsaltinq və Layihə'],
}

// Reverse map: category name → board category
function getBoardCategory(catName: string): string | null {
  for (const [board, cats] of Object.entries(CATEGORY_MAP)) {
    if (cats.includes(catName)) return board
  }
  return null
}

async function main() {
  prisma = await makeScriptPrisma()
  const ORG_ID = 'cmmxg74k10000td3rr37dl6am' // LeadDrive Inc.

  // 1. Read JSON
  const jsonPath = path.join(__dirname, '..', 'public', 'data', 'pricing_data.json')
  const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  const companyCodes = Object.keys(rawData)
  console.log(`Found ${companyCodes.length} companies in JSON`)

  // 2. Collect unique groups, categories, unit types
  const groups = new Set<string>()
  const categories = new Set<string>()
  const unitTypes = new Set<string>()

  for (const info of Object.values(rawData) as any[]) {
    groups.add(info.group)
    for (const [catName, catVal] of Object.entries(info.categories)) {
      categories.add(catName)
      if (typeof catVal === 'object' && catVal !== null && 'services' in catVal) {
        for (const svc of (catVal as any).services) {
          if (svc.unit) unitTypes.add(svc.unit)
        }
      }
    }
  }

  console.log(`Groups: ${groups.size}, Categories: ${categories.size}, Unit types: ${unitTypes.size}`)
  console.log(`Unit types: ${Array.from(unitTypes).join(', ')}`)

  // 3. Clear existing pricing data for this org
  console.log('Clearing existing pricing data...')
  await prisma.pricingService.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.pricingProfileCategory.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.additionalSale.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.pricingProfile.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.pricingCategory.deleteMany({ where: { organizationId: ORG_ID } })
  await prisma.pricingGroup.deleteMany({ where: { organizationId: ORG_ID } })

  // 4. Create groups
  console.log('Creating groups...')
  const groupMap: Record<string, string> = {}
  for (const [idx, name] of GROUP_ORDER.entries()) {
    if (!groups.has(name)) continue
    const g = await prisma.pricingGroup.create({
      data: { organizationId: ORG_ID, name, sortOrder: idx }
    })
    groupMap[name] = g.id
  }
  // Any groups not in GROUP_ORDER
  for (const name of groups) {
    if (!groupMap[name]) {
      const g = await prisma.pricingGroup.create({
        data: { organizationId: ORG_ID, name, sortOrder: 99 }
      })
      groupMap[name] = g.id
    }
  }
  console.log(`Created ${Object.keys(groupMap).length} groups`)

  // 5. Create categories
  console.log('Creating categories...')
  const catMap: Record<string, string> = {}
  let catIdx = 0
  for (const name of categories) {
    const c = await prisma.pricingCategory.create({
      data: {
        organizationId: ORG_ID,
        name,
        boardCategory: getBoardCategory(name),
        sortOrder: catIdx++,
      }
    })
    catMap[name] = c.id
  }
  console.log(`Created ${Object.keys(catMap).length} categories`)

  // 6. Try to match companies to CRM
  const crmCompanies = await prisma.company.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, name: true, costCode: true }
  })
  console.log(`Found ${crmCompanies.length} CRM companies for matching`)

  // Build lookup: uppercase name or costCode → companyId
  const crmLookup: Record<string, string> = {}
  for (const c of crmCompanies) {
    crmLookup[c.name.toUpperCase()] = c.id
    if (c.costCode) crmLookup[c.costCode.toUpperCase()] = c.id
  }

  // 7. Create profiles + categories + services
  console.log('Creating profiles...')
  let profileCount = 0
  let serviceCount = 0
  let linkedCount = 0

  for (const [code, info] of Object.entries(rawData) as [string, any][]) {
    const groupId = groupMap[info.group]
    if (!groupId) {
      console.warn(`  SKIP ${code}: unknown group "${info.group}"`)
      continue
    }

    // Try CRM match
    const companyId = crmLookup[code.toUpperCase()] || null
    if (companyId) linkedCount++

    const profile = await prisma.pricingProfile.create({
      data: {
        organizationId: ORG_ID,
        companyCode: code,
        companyId,
        groupId,
        monthlyTotal: info.monthly || 0,
        annualTotal: info.annual || 0,
      }
    })
    profileCount++

    // Create profile categories + services
    for (const [catName, catVal] of Object.entries(info.categories) as [string, any][]) {
      const categoryId = catMap[catName]
      if (!categoryId) {
        console.warn(`  SKIP category "${catName}" for ${code}: not in catMap`)
        continue
      }

      let catTotal = 0
      if (typeof catVal === 'number') {
        catTotal = catVal
      } else if (catVal && typeof catVal === 'object') {
        catTotal = catVal.total || 0
      }

      const profileCat = await prisma.pricingProfileCategory.create({
        data: {
          organizationId: ORG_ID,
          profileId: profile.id,
          categoryId,
          total: catTotal,
        }
      })

      // Services
      if (typeof catVal === 'object' && catVal !== null && 'services' in catVal && Array.isArray(catVal.services)) {
        for (const [svcIdx, svc] of catVal.services.entries()) {
          const svcQty = svc.qty || 0
          const svcPrice = svc.price || 0
          const svcTotal = svc.total || (svcQty * svcPrice)
          await prisma.pricingService.create({
            data: {
              organizationId: ORG_ID,
              profileCategoryId: profileCat.id,
              name: svc.name || 'Unnamed',
              unit: svc.unit || 'Per Device',
              qty: svcQty,
              price: svcPrice,
              total: svcTotal,
              sortOrder: svcIdx,
            }
          })
          serviceCount++
        }
      }
    }
  }

  console.log(`\n=== Migration Complete ===`)
  console.log(`Profiles: ${profileCount}`)
  console.log(`Linked to CRM: ${linkedCount}`)
  console.log(`Services: ${serviceCount}`)
  console.log(`Groups: ${Object.keys(groupMap).length}`)
  console.log(`Categories: ${Object.keys(catMap).length}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Migration failed:', e)
  prisma.$disconnect()
  process.exit(1)
})
