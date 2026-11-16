/**
 * Sends a single regression-alert email per monitoring audit.
 * Failure is logged but never fails the audit.
 */
export async function sendRegressionAlert(opts: {
  to: string;
  repoName: string;
  auditUrl: string;
  items: { priority: string; title: string }[];
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "Auditflow <alerts@auditflow.app>";
  if (!key || opts.items.length === 0) return;

  const subject = `New issues in ${opts.repoName}`;
  const lines = opts.items.slice(0, 5).map((i) => `• ${i.priority}: ${i.title}`).join("\n");
  const text = `Regression alert for ${opts.repoName}\n\n${lines}\n\nView the report: ${opts.auditUrl}`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      console.error("Resend failed", await res.text());
    }
  } catch (err) {
    console.error("Email send failed", err);
  }
}
