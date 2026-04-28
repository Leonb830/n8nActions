const startButton = document.getElementById("startButton");
const loader = document.getElementById("loader");
const statusMessage = document.getElementById("statusMessage");

const config = window.APP_CONFIG;

function setLoading(isLoading) {
  startButton.disabled = isLoading;
  loader.classList.toggle("hidden", !isLoading);
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function getStoredToken() {
  return sessionStorage.getItem("github_token");
}

function saveToken(token) {
  sessionStorage.setItem("github_token", token);
}

function askForGithubToken() {
  const existingToken = getStoredToken();

  if (existingToken) {
    return existingToken;
  }

  const token = window.prompt(
    "Enter a GitHub token with permission to run workflows in this repository:"
  );

  if (!token || token.trim().length === 0) {
    throw new Error("GitHub token is required to start the workflow.");
  }

  saveToken(token.trim());
  return token.trim();
}

async function triggerWorkflow(token) {
  const url = `https://api.github.com/repos/${config.githubOwner}/${config.githubRepo}/actions/workflows/${config.workflowFileName}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      ref: config.githubBranch
    })
  });

  if (response.status === 204) {
    return;
  }

  const errorText = await response.text();

  throw new Error(
    `Failed to trigger workflow. GitHub returned ${response.status}: ${errorText}`
  );
}

async function fetchN8nUrlJson() {
  const cacheBuster = Date.now();

  const url =
    `https://raw.githubusercontent.com/${config.githubOwner}/${config.githubRepo}` +
    `/${config.githubBranch}/n8n-url.json?cache=${cacheBuster}`;

  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Could not read n8n-url.json. Status: ${response.status}`);
  }

  return response.json();
}

function isFreshUrl(data, startedAt) {
  if (!data || data.status !== "running" || !data.url || !data.created_at) {
    return false;
  }

  const urlCreatedAt = new Date(data.created_at).getTime();

  return urlCreatedAt >= startedAt;
}

async function waitForN8nUrl(startedAt) {
  const deadline = Date.now() + config.maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const data = await fetchN8nUrlJson();

      if (isFreshUrl(data, startedAt)) {
        return data.url;
      }
    } catch (error) {
      console.warn("Waiting for n8n URL:", error);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, config.pollIntervalMs);
    });
  }

  throw new Error("Timed out waiting for the n8n URL.");
}

async function startN8n() {
  const startedAt = Date.now();

  setLoading(true);
  setStatus("Requesting GitHub workflow start...");

  try {
    const token = askForGithubToken();

    await triggerWorkflow(token);

    setStatus("Workflow started. Waiting for n8n container URL...");

    const n8nUrl = await waitForN8nUrl(startedAt);

    setStatus("n8n is ready. Redirecting...");

    window.location.href = n8nUrl;
  } catch (error) {
    console.error(error);

    setStatus(error.message, true);
    setLoading(false);
  }
}

startButton.addEventListener("click", startN8n);
