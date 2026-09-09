import { cancelVoiceQueue } from "@/lib/voice-agent/queue-service"

import { withVoiceQueueMutationAuth } from "../../_shared"
import { runQueueAction, type QueueActionContext } from "../_action"

export const POST = withVoiceQueueMutationAuth<QueueActionContext>(runQueueAction(cancelVoiceQueue))
