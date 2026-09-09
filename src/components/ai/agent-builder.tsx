"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Settings } from "lucide-react"

export function AgentBuilder() {
  const [model, setModel] = useState("haiku")
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(1000)
  const [tools, setTools] = useState({
    webSearch: false,
    emailComposer: true,
    dataAnalysis: true,
    scheduling: false,
  })
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful CRM assistant...")

  const handleToolToggle = (tool: keyof typeof tools) => {
    setTools(prev => ({ ...prev, [tool]: !prev[tool] }))
  }

  return (
    <Card className="ai-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          <CardTitle>Agent Configuration</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <p className="text-sm font-medium mb-2">Model Selection</p>
          <div className="flex gap-2">
            {["haiku", "sonnet", "opus"].map((m) => (
              <Badge
                key={m}
                variant={model === m ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setModel(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Temperature: {temperature.toFixed(1)}</p>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">Controls randomness in responses</p>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Max Tokens</p>
          <Input
            id="maxTokens"
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className=""
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Available Tools</p>
          <div className="space-y-2">
            {Object.entries(tools).map(([tool, enabled]) => (
              <div key={tool} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => handleToolToggle(tool as keyof typeof tools)}
                  className="w-4 h-4 cursor-pointer"
                />
                <label className="text-sm cursor-pointer">{tool.replace(/([A-Z])/g, " $1").trim()}</label>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium mb-2">System Prompt</p>
          <textarea
            id="systemPrompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full p-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background text-foreground"
            rows={4}
          />
        </div>

        <div className="flex gap-2">
          <Button>Save Configuration</Button>
          <Button variant="outline">Reset to Default</Button>
        </div>
      </CardContent>
    </Card>
  )
}
