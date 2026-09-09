"use client"

import { TaskDetailView } from "@/components/tasks/task-detail-view"

// /tasks/[id] route entry. The full task detail + edit UI lives in
// <TaskDetailView>, shared with the board's task modal (which renders the same
// component inside a dialog). In page mode the component reads the [id] route
// param itself and shows the breadcrumb; no props needed here.
export default function TaskDetailPage() {
  return <TaskDetailView />
}
