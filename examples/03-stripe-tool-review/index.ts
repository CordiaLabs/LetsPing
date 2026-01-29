import { LetsPing } from "@letsping/sdk";
import 'dotenv/config';

const lp = new LetsPing({ apiKey: process.env.LETSPING_API_KEY! });

async function processRefund(userId: string, amount: number) {
    console.log(`[-] Initiating refund for User ${userId}...`);

    // Define the tool call structure
    const toolCall = {
        tool: "stripe.refund.create",
        arguments: {
            payment_intent: "pi_3Mtw...",
            amount: amount,
            reason: "requested_by_customer"
        }
    };

    // If amount > $500, force human review
    if (amount > 50000) { // cents
        console.log("[-] High-value refund detected. Requesting authorization.");

        const review = await lp.ask({
            channel: "stripe-risk",
            payload: toolCall,
            description: `Agent attempting refund of $${amount / 100}`,
            blocking: true
        });

        if (review.status === "REJECTED") {
            console.log("[!] Refund blocked by risk team.");
            return;
        }

        // Use the payload returned by LetsPing (in case human changed the amount)
        console.log("[+] Refund approved. Executing Stripe API call:", review.payload);
        // await stripe.refunds.create(review.payload.arguments);
    } else {
        console.log("[+] Auto-approving low value refund.");
    }
}

// Run example
processRefund("user_123", 75000); // $750.00