import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withNormalizedCoordinates, type MtmCoordinateInput } from "@/lib/mtm/geo-coordinates"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobileCapability } from "@/lib/mtm/mobile-capabilities"
import { contactScopeForActor, customerScopeForActor } from "@/lib/mtm/field-scope"
import { verifiedContactDictionaryEntries } from "@/lib/mtm/contact-dictionary-assignment"
import { recordMtmMobileV1SyncActivity } from "@/lib/mtm/mobile-sync-telemetry"

/**
 * GET /api/v1/mtm/mobile/sync/pull
 *
 * Delta pull for offline-first sync (M2-1b).
 *
 * Query params:
 *   since   — ISO timestamp or epoch ms; records updated after this time are returned.
 *             If omitted, returns ALL records (initial sync).
 *   entities — comma-separated subset to fetch (default: all).
 *             Supported: routes,customers,visits,tasks,contacts
 *
 * Response:
 * {
 *   success: true,
 *   timestamp: "<ISO — use this as `since` on next pull>",
 *   changes: {
 *     routes:       { updated: [...], deleted: [] },
 *     customers:    { updated: [...], deleted: [] },
 *     visits:       { updated: [...], deleted: [] },
 *     tasks:        { updated: [...], deleted: [] },
 *     contacts:     { updated: [...], deleted: [] },
 *   }
 * }
 *
 * Note: deleted[] contains IDs of records soft-deleted since `since` (M2-1d).
 */
export const GET = withMobileRls(async (req, auth) => {
  // Authenticated activity is census evidence even if this particular legacy
  // request is later malformed or forbidden. The helper is best-effort and
  // cannot change the v1 response, cursor or any client-owned state.
  recordMtmMobileV1SyncActivity({
    organizationId: auth.orgId,
    agentId: auth.agentId,
    apkVersion: req.headers.get("x-field-apk-version"),
    endpoint: "GET /api/v1/mtm/mobile/sync/pull",
  })
  const forbidden = requireMobileCapability(auth, "FIELD_EXECUTE")
  if (forbidden) return forbidden

  const { searchParams } = new URL(req.url)
  const sinceRaw = searchParams.get("since")
  const entitiesRaw = searchParams.get("entities")
  const limitRaw = searchParams.get("limit")
  const offsetRaw = searchParams.get("offset")

  // Parse `since` — accept ISO string or epoch ms integer
  let since: Date | undefined
  if (sinceRaw) {
    const asMs = Number(sinceRaw)
    since = isNaN(asMs) ? new Date(sinceRaw) : new Date(asMs)
    if (isNaN(since.getTime())) {
      return NextResponse.json({ error: "Invalid `since` parameter" }, { status: 400 })
    }
  }

  const ALL_ENTITIES = ["routes", "customers", "visits", "tasks", "contacts"] as const
  type Entity = typeof ALL_ENTITIES[number]

  const requested: Set<Entity> = entitiesRaw
    ? new Set(entitiesRaw.split(",").filter((e): e is Entity => ALL_ENTITIES.includes(e as Entity)))
    : new Set(ALL_ENTITIES)

  const orgId = auth.orgId
  const agentId = auth.agentId
  const limit = Math.min(500, Math.max(1, Number.parseInt(limitRaw ?? "200", 10) || 200))
  const offset = Math.max(0, Number.parseInt(offsetRaw ?? "0", 10) || 0)

  // Cutoff for agent-scoped entities: return last 14 days max to bound response size
  const recentCutoff = new Date()
  recentCutoff.setDate(recentCutoff.getDate() - 14)
  const visitsSince = since && since > recentCutoff ? since : recentCutoff

  // Server timestamp captured before queries so next pull won't miss records written in flight
  const serverTimestamp = new Date()
  const mobileContactScope = contactScopeForActor({
    agentId,
    role: "AGENT",
    scopedAgentIds: [agentId],
  }, serverTimestamp)
  const mobileCustomerScope = customerScopeForActor({
    agentId,
    role: "AGENT",
    scopedAgentIds: [agentId],
  }, serverTimestamp)

  const sinceFilter = since ? { gt: since } : undefined

  // Filter for soft-deleted records since `since`; only meaningful for delta syncs
  const deletedFilter = since ? { not: null, gt: since } : undefined

  try {
    // Run active-record and deleted-ID queries in parallel (split to stay within TS tuple inference limit)
    const [
      [routes, customers, visits, tasks, contacts],
      [deletedRoutes, deletedCustomers, deletedVisits, deletedTasks, deletedContacts],
      removedRouteAssignments,
      removedCustomerScopes,
      removedContactAssignments,
      removedWorkplaceContactScopes,
    ] = await Promise.all([
      Promise.all([
        // ── Active records ──────────────────────────────────────────
        requested.has("routes")
          ? prisma.mtmRoute.findMany({
              where: {
                organizationId: orgId,
                deletedAt: null,
                AND: [
                  {
                    OR: [
                      { agentId },
                      { assignments: { some: { agentId, removedAt: null } } },
                    ],
                  },
                  ...(sinceFilter
                    ? [{
                        OR: [
                          { updatedAt: sinceFilter },
                          { assignments: { some: { agentId, removedAt: null, updatedAt: sinceFilter } } },
                        ],
                      }]
                    : []),
                ],
              },
              include: {
                assignments: {
                  where: { removedAt: null },
                  select: { agentId: true, role: true, assignedAt: true },
                  orderBy: { assignedAt: "asc" },
                },
                points: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    customerId: true,
                    contactId: true,
                    orderIndex: true,
                    status: true,
                    plannedTime: true,
                    // v1 intentionally keeps its compatibility projection driven by
                    // the parent route's delta. R6 adds point.updatedAt for the
                    // separate v2 stream; adding it here would silently change the
                    // legacy mixed cursor contract.
                    customer: { select: { id: true, name: true, address: true, code: true } },
                  },
                },
              },
            })
          : Promise.resolve(null),

        requested.has("customers")
          ? prisma.mtmCustomer.findMany({
              where: {
                organizationId: orgId,
                deletedAt: null,
                AND: [mobileCustomerScope],
                ...(sinceFilter
                  ? {
                      OR: [
                        { updatedAt: sinceFilter },
                        {
                          attributeFacts: {
                            some: {
                              // Any package state change must refresh the row:
                              // a customer omitted from the replacement package
                              // receives attributeFacts: [] and clears stale data.
                              package: { updatedAt: sinceFilter },
                            },
                          },
                        },
                        { agentAssignments: { some: { agentId, updatedAt: sinceFilter } } },
                        {
                          agentAssignments: {
                            some: {
                              agentId,
                              deletedAt: null,
                              effectiveFrom: { gt: since, lte: serverTimestamp },
                            },
                          },
                        },
                        {
                          routePoints: {
                            some: {
                              deletedAt: null,
                              route: {
                                organizationId: orgId,
                                deletedAt: null,
                                OR: [
                                  { agentId, updatedAt: sinceFilter },
                                  {
                                    assignments: {
                                      some: { agentId, removedAt: null, updatedAt: sinceFilter },
                                    },
                                  },
                                ],
                              },
                            },
                          },
                        },
                      ],
                    }
                  : {}),
              },
              select: {
                id: true,
                name: true,
                code: true,
                objectType: true,
                status: true,
                address: true,
                region: true,
                administrativeDistrict: true,
                locality: true,
                cityDistrict: true,
                city: true,
                district: true,
                specialization: true,
                organizationKind: true,
                territoryCode: true,
                managingManagerId: true,
                managingManager: { select: { id: true, name: true, role: true, status: true } },
                latitude: true,
                longitude: true,
                category: true,
                phone: true,
                contactPerson: true,
                notes: true,
                geofenceRadius: true,
                polygon: true,
                attributeFacts: {
                  where: {
                    package: { status: "ACTIVE", effectiveFrom: { lte: serverTimestamp } },
                  },
                  orderBy: { id: "asc" },
                  take: 1,
                  select: {
                    medicalCategoryCode: true,
                    medicalCategoryLabels: true,
                    licenseStatus: true,
                    licenseLabels: true,
                    polygonCode: true,
                    polygonLabels: true,
                    package: {
                      select: {
                        version: true,
                        rowsHash: true,
                        approvalReference: true,
                        sourceSystem: true,
                        sourceReference: true,
                        sourceObservedAt: true,
                        effectiveFrom: true,
                        signedAt: true,
                      },
                    },
                  },
                },
                createdAt: true,
                updatedAt: true,
                agentAssignments: {
                  where: {
                    agentId,
                    deletedAt: null,
                    effectiveFrom: { lte: serverTimestamp },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: serverTimestamp } }],
                  },
                  orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
                  select: {
                    id: true,
                    agentId: true,
                    role: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    source: true,
                    reason: true,
                    updatedAt: true,
                  },
                },
                routePoints: {
                  where: {
                    deletedAt: null,
                    route: {
                      organizationId: orgId,
                      deletedAt: null,
                      OR: [
                        { agentId },
                        { assignments: { some: { agentId, removedAt: null } } },
                      ],
                    },
                  },
                  orderBy: [{ route: { date: "desc" } }, { orderIndex: "asc" }],
                  take: 20,
                  select: {
                    id: true,
                    routeId: true,
                    orderIndex: true,
                    status: true,
                    plannedTime: true,
                    route: {
                      select: {
                        id: true,
                        date: true,
                        name: true,
                        status: true,
                        version: true,
                        updatedAt: true,
                      },
                    },
                  },
                },
                _count: {
                  select: {
                    contactWorkplaces: { where: { deletedAt: null, endedOn: null } },
                    visits: { where: { deletedAt: null } },
                  },
                },
              },
            })
          : Promise.resolve(null),

        requested.has("visits")
          ? prisma.mtmVisit.findMany({
              where: {
                organizationId: orgId,
                agentId,
                deletedAt: null,
                checkInAt: { gte: visitsSince },
                ...(sinceFilter ? { updatedAt: sinceFilter } : {}),
              },
              select: {
                id: true,
                customerId: true,
                contactId: true,
                status: true,
                checkInAt: true,
                checkOutAt: true,
                checkInLat: true,
                checkInLng: true,
                checkOutLat: true,
                checkOutLng: true,
                notes: true,
                updatedAt: true,
                customer: { select: { id: true, name: true } },
              },
            })
          : Promise.resolve(null),

        requested.has("tasks")
          ? prisma.mtmTask.findMany({
              where: {
                organizationId: orgId,
                agentId,
                deletedAt: null,
                ...(sinceFilter ? { updatedAt: sinceFilter } : {}),
              },
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                priority: true,
                scheduledStartAt: true,
                dueDate: true,
                customerId: true,
                visitId: true,
                result: true,
                progress: true,
                returnReason: true,
                version: true,
                acceptedAt: true,
                startedAt: true,
                completedAt: true,
                sourceKey: true,
                recurrenceRule: true,
                recurrenceInterval: true,
                recurrenceUntil: true,
                recurrenceTimezone: true,
                recurrenceAnchorScheduledStartAt: true,
                recurrenceAnchorDueDate: true,
                recurrenceCursorScheduledStartAt: true,
                recurrenceCursorDueDate: true,
                recurrenceParentId: true,
                copiedFromId: true,
                taskGroupDictionaryId: true,
                taskGroupCode: true,
                updatedAt: true,
              },
            })
          : Promise.resolve(null),

        requested.has("contacts")
          ? prisma.mtmContact.findMany({
              where: {
                organizationId: orgId,
                deletedAt: null,
                AND: [mobileContactScope],
                ...(sinceFilter
                  ? {
                      OR: [
                        { updatedAt: sinceFilter },
                        { workplaces: { some: { updatedAt: sinceFilter } } },
                        { doctorAssessments: { some: { updatedAt: sinceFilter } } },
                        { dictionaryAssignments: { some: { updatedAt: sinceFilter } } },
                        { fieldPotentials: { some: { updatedAt: sinceFilter } } },
                        { agentAssignments: { some: { agentId, updatedAt: sinceFilter } } },
                        {
                          agentAssignments: {
                            some: {
                              agentId,
                              deletedAt: null,
                              effectiveFrom: { gt: since, lte: serverTimestamp },
                            },
                          },
                        },
                        {
                          workplaces: {
                            some: {
                              deletedAt: null,
                              endedOn: null,
                              customer: {
                                agentAssignments: {
                                  some: { agentId, updatedAt: sinceFilter },
                                },
                              },
                            },
                          },
                        },
                        {
                          workplaces: {
                            some: {
                              deletedAt: null,
                              endedOn: null,
                              customer: {
                                routePoints: {
                                  some: {
                                    deletedAt: null,
                                    route: {
                                      deletedAt: null,
                                      OR: [
                                        { agentId, updatedAt: sinceFilter },
                                        {
                                          assignments: {
                                            some: { agentId, updatedAt: sinceFilter },
                                          },
                                        },
                                      ],
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      ],
                    }
                  : {}),
              },
              select: {
                id: true,
                externalCode: true,
                firstName: true,
                lastName: true,
                middleName: true,
                displayName: true,
                specialtyCode: true,
                specialtyName: true,
                qualificationCategory: true,
                profile: true,
                type: true,
                category: true,
                status: true,
                birthDate: true,
                gender: true,
                phone: true,
                email: true,
                messengerPhone: true,
                workPhone: true,
                homePhone: true,
                mobilePhone: true,
                viberPhone: true,
                whatsappPhone: true,
                telegramPhone: true,
                postalCode: true,
                addressRegion: true,
                addressLocality: true,
                addressDistrict: true,
                addressStreet: true,
                productCategory: true,
                verificationStatus: true,
                consentStatus: true,
                contactPreference: true,
                source: true,
                duplicateOfContactId: true,
                notes: true,
                agentAssignments: {
                  where: {
                    agentId,
                    deletedAt: null,
                    effectiveFrom: { lte: serverTimestamp },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gt: serverTimestamp } }],
                  },
                  orderBy: [{ role: "asc" }, { effectiveFrom: "desc" }],
                  select: {
                    id: true,
                    agentId: true,
                    role: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    reason: true,
                    updatedAt: true,
                  },
                },
                workplaces: {
                  where: { deletedAt: null },
                  orderBy: [{ endedOn: "asc" }, { isPrimary: "desc" }, { startedOn: "desc" }],
                  select: {
                    id: true,
                    customerId: true,
                    jobTitle: true,
                    department: true,
                    room: true,
                    phone: true,
                    isPrimary: true,
                    startedOn: true,
                    endedOn: true,
                    source: true,
                    updatedAt: true,
                    customer: { select: { id: true, name: true, objectType: true, city: true, address: true } },
                  },
                },
                fieldPotentials: {
                  where: { deletedAt: null, OR: [{ agentId: null }, { agentId }] },
                  orderBy: [{ periodStart: "desc" }, { updatedAt: "desc" }],
                  select: {
                    id: true,
                    clientPotentialId: true,
                    agentId: true,
                    brandExternalId: true,
                    brandName: true,
                    productExternalId: true,
                    productName: true,
                    category: true,
                    categoryLabel: true,
                    potentialValue: true,
                    coverageValue: true,
                    periodStart: true,
                    periodEnd: true,
                    source: true,
                    formulaVersion: true,
                    provenance: true,
                    status: true,
                    reviewComment: true,
                    reviewedAt: true,
                    closedAt: true,
                    supersedesPotentialId: true,
                    createdAt: true,
                    updatedAt: true,
                    agent: { select: { id: true, name: true } },
                    enteredByAgent: { select: { id: true, name: true } },
                    reviewedByAgent: { select: { id: true, name: true } },
                    evidenceVisits: {
                      select: {
                        visit: { select: { id: true, checkInAt: true, checkOutAt: true, status: true, customer: { select: { id: true, name: true } } } },
                      },
                    },
                  },
                },
                doctorAssessments: {
                  orderBy: [{ periodStart: "desc" }, { createdAt: "desc" }],
                  take: 50,
                  select: {
                    id: true,
                    clientAssessmentId: true,
                    office: true,
                    patientsPerMonth: true,
                    bedCount: true,
                    isKol: true,
                    kolLevel: true,
                    profile: true,
                    psychotype: true,
                    granularCategory: true,
                    actualScore: true,
                    targetScore: true,
                    periodStart: true,
                    periodEnd: true,
                    source: true,
                    provenance: true,
                    formulaVersion: true,
                    status: true,
                    reviewComment: true,
                    reviewedAt: true,
                    createdAt: true,
                    updatedAt: true,
                    formula: {
                      select: {
                        id: true,
                        version: true,
                        name: true,
                        definition: true,
                        definitionHash: true,
                        glossarySchemaVersion: true,
                        approvalReference: true,
                        sourceSystem: true,
                        sourceReference: true,
                        sourceObservedAt: true,
                        status: true,
                        signedAt: true,
                      },
                    },
                  },
                },
                dictionaryAssignments: {
                  where: { effectiveTo: null },
                  orderBy: [{ kind: "asc" }, { entryCode: "asc" }],
                  select: {
                    id: true,
                    dictionaryId: true,
                    kind: true,
                    entryCode: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    source: true,
                    approvedByUserId: true,
                    updatedAt: true,
                    dictionary: {
                      select: {
                        id: true,
                        organizationId: true,
                        kind: true,
                        version: true,
                        nameRu: true,
                        nameAz: true,
                        nameEn: true,
                        entries: true,
                        entriesHash: true,
                        approvalReference: true,
                        signedByUserId: true,
                        signedAt: true,
                        activatedAt: true,
                        retiredAt: true,
                        status: true,
                      },
                    },
                  },
                },
                updatedAt: true,
              },
            })
          : Promise.resolve(null),
      ]),

      Promise.all([
        // ── Deleted record IDs (delta syncs only) ──────────────────
        requested.has("routes") && deletedFilter
          ? prisma.mtmRoute.findMany({
              where: {
                organizationId: orgId,
                OR: [
                  { agentId },
                  { assignments: { some: { agentId, removedAt: null } } },
                ],
                deletedAt: deletedFilter,
              },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),

        requested.has("customers") && deletedFilter
          ? prisma.mtmCustomer.findMany({
              where: {
                organizationId: orgId,
                deletedAt: deletedFilter,
                OR: [
                  { agentAssignments: { some: { agentId } } },
                  {
                    routePoints: {
                      some: {
                        route: {
                          OR: [
                            { agentId },
                            { assignments: { some: { agentId } } },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),

        requested.has("visits") && deletedFilter
          ? prisma.mtmVisit.findMany({
              where: { organizationId: orgId, agentId, deletedAt: deletedFilter },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),

        requested.has("tasks") && deletedFilter
          ? prisma.mtmTask.findMany({
              where: { organizationId: orgId, agentId, deletedAt: deletedFilter },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),

        requested.has("contacts") && deletedFilter
          ? prisma.mtmContact.findMany({
              where: {
                organizationId: orgId,
                deletedAt: deletedFilter,
                OR: [
                  { agentAssignments: { some: { agentId } } },
                  {
                    workplaces: {
                      some: {
                        customer: {
                          OR: [
                            { agentAssignments: { some: { agentId } } },
                            {
                              routePoints: {
                                some: {
                                  route: {
                                    OR: [
                                      { agentId },
                                      { assignments: { some: { agentId } } },
                                    ],
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    },
                  },
                ],
              },
              select: { id: true },
            })
          : Promise.resolve([] as Array<{ id: string }>),
      ]),

      // Assignment changes do not update the parent route's updatedAt. A
      // participant removal therefore needs an explicit tombstone so an
      // offline client drops the route on its next delta pull.
      requested.has("routes") && since
        ? prisma.mtmRouteAssignment.findMany({
            where: {
              organizationId: orgId,
              agentId,
              removedAt: { not: null, gt: since },
            },
            select: { routeId: true },
          })
        : Promise.resolve([] as Array<{ routeId: string }>),

      // Organization visibility can come from either an effective ownership
      // assignment or a route. Recheck both paths after their independent
      // relation updates and emit a tombstone only when the complete web-
      // equivalent scope is gone.
      requested.has("customers") && since
        ? prisma.mtmCustomer.findMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              NOT: mobileCustomerScope,
              OR: [
                {
                  agentAssignments: {
                    some: {
                      agentId,
                      OR: [
                        { deletedAt: { not: null, gt: since } },
                        { effectiveTo: { gt: since, lte: serverTimestamp } },
                        { updatedAt: { gt: since } },
                      ],
                    },
                  },
                },
                {
                  routePoints: {
                    some: {
                      route: {
                        organizationId: orgId,
                        OR: [
                          { agentId, updatedAt: { gt: since } },
                          {
                            assignments: {
                              some: { agentId, updatedAt: { gt: since } },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              ],
            },
            select: { id: true },
          })
        : Promise.resolve([] as Array<{ id: string }>),

      // Contact assignments are effective-dated independently of the contact
      // master row. Emit a tombstone only when the agent has no assignment
      // active at the server cutoff; this removes stale offline list entries
      // after unassignment/transfer without deleting shared master data.
      requested.has("contacts") && since
        ? prisma.mtmContactAgentAssignment.findMany({
            where: {
              organizationId: orgId,
              agentId,
              OR: [
                { deletedAt: { not: null, gt: since } },
                { effectiveTo: { gt: since, lte: serverTimestamp } },
                {
                  updatedAt: { gt: since },
                  effectiveTo: { lte: serverTimestamp },
                },
              ],
              contact: {
                is: {
                  deletedAt: null,
                  NOT: mobileContactScope,
                },
              },
            },
            select: { contactId: true },
          })
        : Promise.resolve([] as Array<{ contactId: string }>),

      // A contact can be visible without a direct contact assignment when an
      // active workplace is in the agent's organization/route scope. Recheck
      // those indirect links after assignment or route updates and evict the
      // contact only if the complete web-equivalent scope is now empty.
      requested.has("contacts") && since
        ? prisma.mtmContact.findMany({
            where: {
              organizationId: orgId,
              deletedAt: null,
              NOT: mobileContactScope,
              workplaces: {
                some: {
                  deletedAt: null,
                  endedOn: null,
                  customer: {
                    OR: [
                      {
                        agentAssignments: {
                          some: {
                            agentId,
                            OR: [
                              { deletedAt: { not: null, gt: since } },
                              { effectiveTo: { gt: since, lte: serverTimestamp } },
                              { updatedAt: { gt: since } },
                            ],
                          },
                        },
                      },
                      {
                        routePoints: {
                          some: {
                            deletedAt: null,
                            route: {
                              organizationId: orgId,
                              OR: [
                                { updatedAt: { gt: since } },
                                {
                                  assignments: {
                                    some: { agentId, updatedAt: { gt: since } },
                                  },
                                },
                              ],
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            select: { id: true },
          })
        : Promise.resolve([] as Array<{ id: string }>),
    ])

    const deletedRouteIds = [...new Set([
      ...deletedRoutes.map((record: { id: string }) => record.id),
      ...removedRouteAssignments.map((assignment: { routeId: string }) => assignment.routeId),
    ])]
    const deletedCustomerIds = [...new Set([
      ...deletedCustomers.map((record: { id: string }) => record.id),
      ...removedCustomerScopes.map((record: { id: string }) => record.id),
    ])]
    const deletedContactIds = [...new Set([
      ...deletedContacts.map((record: { id: string }) => record.id),
      ...removedContactAssignments.map((assignment: { contactId: string }) => assignment.contactId),
      ...removedWorkplaceContactScopes.map((record: { id: string }) => record.id),
    ])]

    const page = <T,>(rows: T[]) => rows.slice(offset, offset + limit)
    const pageInfo = (rows: unknown[]) => ({
      limit,
      offset,
      hasMore: rows.length > offset + limit,
      nextOffset: rows.length > offset + limit ? offset + limit : null,
    })

    const governedContacts = contacts?.map((contact) => ({
      ...contact,
      dictionaryAssignments: (contact.dictionaryAssignments ?? []).map((assignment) => {
        const entries = verifiedContactDictionaryEntries(assignment.dictionary)
        const entry = entries?.find((candidate) => candidate.code === assignment.entryCode) ?? null
        const valid = assignment.dictionary.kind === assignment.kind && entry !== null
        return {
          id: assignment.id,
          dictionaryId: assignment.dictionaryId,
          kind: assignment.kind,
          entryCode: assignment.entryCode,
          effectiveFrom: assignment.effectiveFrom,
          effectiveTo: assignment.effectiveTo,
          source: assignment.source,
          approvedByUserId: assignment.approvedByUserId,
          updatedAt: assignment.updatedAt,
          valid,
          entry: valid ? entry : null,
          dictionary: {
            id: assignment.dictionary.id,
            kind: assignment.dictionary.kind,
            version: assignment.dictionary.version,
            nameRu: assignment.dictionary.nameRu,
            nameAz: assignment.dictionary.nameAz,
            nameEn: assignment.dictionary.nameEn,
            approvalReference: assignment.dictionary.approvalReference,
            signedAt: assignment.dictionary.signedAt,
            retiredAt: assignment.dictionary.retiredAt,
            status: assignment.dictionary.status,
          },
        }
      }),
    })) ?? null

    return NextResponse.json({
      success: true,
      timestamp: serverTimestamp.toISOString(),
      changes: {
        ...(routes !== null && {
          routes: { updated: page(routes), deleted: page(deletedRouteIds) },
        }),
        ...(customers !== null && {
          customers: {
            // Coordinates leave the server as a full pair or as null/null; the
            // field app must never compute a distance from 0,0 (audit M-02).
            // The nested Promise.all tuple types its rows as `unknown`; the
            // customer select above always carries the coordinate pair.
            updated: page(customers).map((customer) => withNormalizedCoordinates(customer as MtmCoordinateInput & Record<string, unknown>)),
            deleted: page(deletedCustomerIds),
            projection: "organization-core-v3",
            scope: "effective-assignment-or-active-route",
            asOf: serverTimestamp.toISOString(),
          },
        }),
        ...(visits !== null && {
          visits: { updated: page(visits), deleted: page(deletedVisits.map((r: { id: string }) => r.id)) },
        }),
        ...(tasks !== null && {
          tasks: { updated: page(tasks), deleted: page(deletedTasks.map((r: { id: string }) => r.id)) },
        }),
        ...(contacts !== null && {
          contacts: {
            updated: page(governedContacts ?? []),
            deleted: page(deletedContactIds),
            projection: "contact-core-v4-governed-dictionaries",
          },
        }),
      },
      pagination: {
        routes: routes === null ? null : pageInfo(routes),
        customers: customers === null ? null : pageInfo(customers),
        visits: visits === null ? null : pageInfo(visits),
        tasks: tasks === null ? null : pageInfo(tasks),
        contacts: contacts === null ? null : pageInfo(contacts),
      },
    })
  } catch (e) {
    console.error("[MTM/mobile/sync/pull GET]", e)
    return NextResponse.json({ error: "Sync pull failed" }, { status: 500 })
  }
})
