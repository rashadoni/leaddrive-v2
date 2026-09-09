export interface RoutablePipeline {
  id: string
  name: string
  isDefault?: boolean
  isActive?: boolean
}

function normalizePipelineName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("ı", "i")
    .trim()
    .toLowerCase()
}

export function findSalesPipeline<T extends RoutablePipeline>(pipelines: T[]): T | undefined {
  return pipelines.find((pipeline) =>
    ["satis", "sales"].includes(normalizePipelineName(pipeline.name)),
  )
}

export function findSmmPipeline<T extends RoutablePipeline>(pipelines: T[]): T | undefined {
  return pipelines.find((pipeline) => normalizePipelineName(pipeline.name) === "smm")
}
