// The Activity page (owners): who did what in the organization, newest first. Read-only: the
// database's activity log can't be changed or deleted by anyone.

import * as api from "../api.js";
import { escape } from "../ui.js";
import { ACTIVITY_GROUPS, describeActivity, actorLabel } from "../activity-model.js";

const PAGE_SIZE = 100;

export function mountActivity(root) {
  const state = { group: "all", entries: [], more: false, loading: true, error: null };

  async function load(append = false) {
    state.loading = true;
    state.error = null;
    render();
    try {
      const before = append ? state.entries.at(-1)?.id : undefined;
      const rows = await api.loadActivity({ group: state.group, before, limit: PAGE_SIZE });
      state.entries = append ? state.entries.concat(rows) : rows;
      state.more = rows.length === PAGE_SIZE;
    } catch (error) {
      state.error = api.describe(error);
    }
    state.loading = false;
    render();
  }

  const when = (value) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  function render() {
    root.innerHTML = `
      <div class="toolbar">
        <div>
          <h1>Activity</h1>
          <p class="meta">Who did what in your organization: people and logins, stores, forms, options, deleted records, and sign-in emails. Newest first. Nobody can change or remove entries.</p>
        </div>
      </div>
      <div class="segmented" role="group" aria-label="Show">
        ${ACTIVITY_GROUPS.map((group) => `<button class="segment${state.group === group.id ? " active" : ""}" data-group="${group.id}"${state.group === group.id ? ' aria-pressed="true"' : ""}>${group.label}</button>`).join("")}
      </div>
      <div class="card">
        ${state.error ? `<p class="form-error">${escape(state.error)}</p>` : ""}
        ${state.entries.length ? `
          <ol class="activity-list">
            ${state.entries.map((entry) => `
              <li>
                <time datetime="${escape(entry.at)}">${escape(when(entry.at))}</time>
                <p><strong>${escape(actorLabel(entry))}</strong> ${escape(describeActivity(entry))}</p>
              </li>`).join("")}
          </ol>` : ""}
        ${!state.entries.length && !state.loading && !state.error ? '<p class="meta">Nothing yet. Changes people make from now on appear here.</p>' : ""}
        ${state.loading ? '<p class="loading">Loading…</p>' : ""}
        ${state.more && !state.loading ? '<button class="secondary" data-more>Show More</button>' : ""}
      </div>`;
  }

  root.addEventListener("click", (event) => {
    const group = event.target.closest("[data-group]");
    if (group && !state.loading) {
      state.group = group.dataset.group;
      load();
      return;
    }
    if (event.target.closest("[data-more]") && !state.loading) load(true);
  });

  load();
  return () => true;
}
