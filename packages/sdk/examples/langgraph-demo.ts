import { StateGraph, START } from "@langchain/langgraph";
import { LetsPing } from "@letsping/sdk";
import { LetsPingCheckpointer } from "@letsping/sdk/integrations/langgraph";

type DemoState = {
  thread_id: string;
  step: "START" | "NEEDS_APPROVAL" | "DONE";
  amount: number;
};

const lp = new LetsPing(process.env.LETSPING_API_KEY!);
const checkpointer = new LetsPingCheckpointer(lp);

// Chain the methods directly off the instantiation
const builder = new StateGraph<DemoState>({
  channels: {
    thread_id: null,
    step: null,
    amount: null,
  },
})
  .addNode("charge_step", async (state: DemoState): Promise<DemoState> => {
    // On the first pass, ask LetsPing for approval and park state.
    if (state.step === "START") {
      const decision = await lp.defer({
        service: "demo-agent",
        action: "payments:charge",
        priority: "high",
        payload: { amount: state.amount },
        // Persist enough context so the webhook can resume the same thread.
        state_snapshot: {
          thread_id: state.thread_id,
          input: state,
        },
      });

      console.log("Queued LetsPing request id:", decision.id);

      return {
        ...state,
        step: "NEEDS_APPROVAL",
      };
    }

    // After approval + webhook resume, the graph will be invoked again
    if (state.step === "NEEDS_APPROVAL") {
      console.log("Approval received. Performing final charge for:", state.amount);
      return {
        ...state,
        step: "DONE",
      };
    }

    return state;
  })
  // Notice we are chaining addEdge directly after addNode
  .addEdge(START, "charge_step");

export const demoGraph = builder.compile({ checkpointer });

if (require.main === module) {
  (async () => {
    const threadId = `demo-${Date.now()}`;
    console.log("Starting demo thread:", threadId);

    await demoGraph.invoke(
      {
        thread_id: threadId,
        step: "START",
        amount: 500,
      },
      { configurable: { thread_id: threadId } },
    );

    console.log("Demo graph invoked. Wait for LetsPing approval, then webhook will resume.");
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}