export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

export function setDotClass(id, className) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.remove("good", "warn", "bad", "idle");
  el.classList.add(className);
}

export function showPage(pageName) {
  $$(".page").forEach((page) => {
    page.classList.remove("active");
  });

  $$(".nav-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const page = $(`#page-${pageName}`);
  const navButton = $(`.nav-btn[data-page="${pageName}"]`);

  if (page) page.classList.add("active");
  if (navButton) navButton.classList.add("active");
}

export function toast(message, type = "info") {
  const toastEl = $("#toast");
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.className = "toast show";

  if (type === "success") toastEl.classList.add("toast-success");
  if (type === "error") toastEl.classList.add("toast-error");
  if (type === "warning") toastEl.classList.add("toast-warning");

  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
}

export function renderTable(tbodyId, columns, data) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">No data yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map((row) => {
      return `<tr>${columns
        .map((col) => `<td>${row[col] !== undefined && row[col] !== null ? row[col] : "-"}</td>`)
        .join("")}</tr>`;
    })
    .join("");
}

export function showLoading(message = "Working...") {
  const overlay = document.getElementById("loading-overlay");
  const text = document.getElementById("loading-message");

  if (!overlay) return;

  if (text) {
    text.textContent = message;
  }

  overlay.classList.remove("hidden");
}

export function hideLoading() {
  const overlay = document.getElementById("loading-overlay");
  if (!overlay) return;

  overlay.classList.add("hidden");
}

export function setActivity(id, busy, busyText = "Running...", idleText = "Idle") {
  const el = document.getElementById(id);
  if (!el) return;

  if (busy) {
    el.innerHTML = `<span class="spinner small"></span>&nbsp;${busyText}`;
  } else {
    el.textContent = idleText;
  }
}
