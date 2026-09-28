const GITHUB_API = "https://api.github.com";
const OWNER = "legendalive";
const REPO = "AegisTrader";

async function githubFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  
  if (!res.ok) {
    const errText = await res.text();
    // This will now show the exact reason for the 404/403
    throw new Error(`GitHub API ${res.status}: ${errText}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function triggerWorkflow(workflowFile, token) {
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`;
  await githubFetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ ref: "main" })
  });
}

export async function updateKillSwitch(enabled, token) {
  const path = "state/kill-switch.json";
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`;
  
  const fileData = await githubFetch(url, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  
  const newContent = JSON.stringify({ enabled: enabled, reason: enabled ? "Triggered from dashboard" : "" }, null, 2);
  const encoded = btoa(unescape(encodeURIComponent(newContent)));
  
  await githubFetch(url, {
    method: "PUT",
    headers: { "Authorization": `Bearer ${token}` },
    body: JSON.stringify({
      message: enabled ? "Enable kill switch from dashboard" : "Disable kill switch from dashboard",
      content: encoded,
      sha: fileData.sha
    })
  });
}
