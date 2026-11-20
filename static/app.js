(function () {
  "use strict";

  let tasks = [];
  let currentFilter = "all";
  let currentCategory = "";

  const $ = (sel) => document.querySelector(sel);

  const taskList = $("#taskList");
  const empty = $("#empty");
  const stat = $("#stat");
  const addForm = $("#addForm");
  const categoryFilter = $("#categoryFilter");
  const weeklyList = $("#weeklyList");
  const weeklyEmpty = $("#weeklyEmpty");
  const weekInfo = $("#weekInfo");

  // ---------- API ----------
  async function api(url, options) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok && res.status !== 404) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "请求失败");
    }
    return res.json();
  }

  const getTasks = () => api("/api/tasks");
  const createTask = (body) => api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
  const updateTask = (id, body) => api("/api/tasks/" + id, { method: "PUT", body: JSON.stringify(body) });
  const deleteTask = (id) => api("/api/tasks/" + id, { method: "DELETE" });

  // ---------- 工具 ----------
  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function isOverdue(t) {
    return !t.done && t.due && t.due < todayStr();
  }

  // 已完成任务距自动删除的剩余时间（12 小时）
  const AUTO_DELETE_MS = 12 * 60 * 60 * 1000;
  function autoDeleteHint(t) {
    if (!t.done || !t.completed_at) return "";
    const ca = new Date(t.completed_at);
    if (isNaN(ca.getTime())) return "";
    const remain = ca.getTime() + AUTO_DELETE_MS - Date.now();
    if (remain <= 0) return "即将删除";
    const h = Math.floor(remain / 3600000);
    const m = Math.floor((remain % 3600000) / 60000);
    return h > 0 ? `${h} 小时后自动删除` : `${m} 分钟后自动删除`;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- 渲染 ----------
  function weekRange() {
    const now = new Date();
    const day = now.getDay(); // 0=周日
    const diff = day === 0 ? -6 : 1 - day; // 到本周一的偏移
    const monday = new Date(now);
    monday.setDate(now.getDate() + diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    return `${fmt(monday)} - ${fmt(sunday)}`;
  }

  function render() {
    const weekly = tasks.filter((t) => t.is_weekly);
    const normal = tasks.filter((t) => !t.is_weekly);

    const categories = [...new Set(normal.map((t) => t.category).filter(Boolean))];
    const current = categoryFilter.value;
    categoryFilter.innerHTML =
      '<option value="">全部分类</option>' +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    categoryFilter.value = categories.includes(current) ? current : "";

    // 每周任务栏目（不参与下方筛选，独立展示）
    weekInfo.textContent = `本周 ${weekRange()} · 每周一自动刷新`;
    weeklyList.innerHTML = weekly.map(weeklyCard).join("");
    weeklyEmpty.style.display = weekly.length ? "none" : "block";

    // 普通任务
    let list = normal.slice();
    if (currentFilter === "active") list = list.filter((t) => !t.done);
    else if (currentFilter === "done") list = list.filter((t) => t.done);
    else if (currentFilter === "overdue") list = list.filter(isOverdue);
    if (categoryFilter.value) list = list.filter((t) => t.category === categoryFilter.value);

    const pOrder = { 高: 0, 中: 1, 低: 2 };
    list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (pOrder[a.priority] !== pOrder[b.priority])
        return pOrder[a.priority] - pOrder[b.priority];
      return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
    });

    taskList.innerHTML = list.map(taskCard).join("");
    empty.style.display = list.length ? "none" : "block";

    const done = tasks.filter((t) => t.done).length;
    const overdue = normal.filter(isOverdue).length;
    const weeklyDone = weekly.filter((t) => t.done).length;
    stat.textContent = `共 ${tasks.length} 项 · 已完成 ${done} 项 · 已逾期 ${overdue} 项 · 本周每周任务 ${weeklyDone}/${weekly.length}`;
  }

  function metaBadges(t, overdue) {
    const priClass = t.priority === "高" ? "high" : t.priority === "低" ? "low" : "mid";
    const dueStr = t.due ? (overdue ? "已逾期 · " : "截止 ") + t.due : "";
    let meta = `<span class="badge ${priClass}">${escapeHtml(t.priority)}</span>`;
    if (t.category) meta += `<span class="badge cat">${escapeHtml(t.category)}</span>`;
    if (t.due)
      meta += `<span class="badge ${overdue ? "overdue" : ""}">${escapeHtml(dueStr)}</span>`;
    return meta;
  }

  function weeklyCard(t) {
    const overdue = isOverdue(t);
    let meta = metaBadges(t, overdue);
    meta += `<span class="badge weekly" title="每周重复任务，每周一自动刷新">🔁 每周</span>`;
    meta += `<span class="badge cycles" title="累计完成的周期数">✅ 已完成 ${t.cycles || 0} 周</span>`;
    if (t.done)
      meta += `<span class="badge weekdone" title="本周已完成">本周已完成</span>`;

    const note = t.note ? `<div class="task-note">${escapeHtml(t.note)}</div>` : "";
    const pri = t.priority === "高" ? "high" : t.priority === "低" ? "low" : "high";

    return `
      <li class="task ${t.done ? "done" : ""} p-${pri}" data-id="${t.id}" data-weekly="1">
        <div class="checkbox" data-action="toggle" title="标记本周完成/未完成"></div>
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-meta">${meta}</div>
          ${note}
        </div>
        <div class="task-actions">
          <button class="icon-btn" data-action="edit" title="编辑">✏️</button>
          <button class="icon-btn del" data-action="del" title="删除">🗑️</button>
        </div>
      </li>`;
  }

  function taskCard(t) {
    const overdue = isOverdue(t);
    let meta = metaBadges(t, overdue);
    const autoHint = autoDeleteHint(t);
    if (autoHint)
      meta += `<span class="badge autodel" title="勾选完成后 12 小时自动删除">⏱ ${escapeHtml(autoHint)}</span>`;

    const note = t.note ? `<div class="task-note">${escapeHtml(t.note)}</div>` : "";

    return `
      <li class="task ${t.done ? "done" : ""} p-${t.priority === "高" ? "high" : t.priority === "低" ? "low" : "high"}"
          data-id="${t.id}">
        <div class="checkbox" data-action="toggle" title="标记完成/未完成"></div>
        <div class="task-body">
          <div class="task-title">${escapeHtml(t.title)}</div>
          <div class="task-meta">${meta}</div>
          ${note}
        </div>
        <div class="task-actions">
          <button class="icon-btn" data-action="edit" title="编辑">✏️</button>
          <button class="icon-btn del" data-action="del" title="删除">🗑️</button>
        </div>
      </li>`;
  }

  // ---------- 事件 ----------
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#titleInput").value.trim();
    if (!title) return;
    const isWeekly = $("#weeklyInput").checked;
    const body = {
      title,
      priority: $("#priorityInput").value,
      due: $("#dueInput").value,
      category: $("#categoryInput").value.trim(),
      created: new Date().toLocaleString("zh-CN"),
      is_weekly: isWeekly,
    };
    await createTask(body);
    $("#titleInput").value = "";
    $("#categoryInput").value = "";
    $("#weeklyInput").checked = false;
    await refresh();
  });

  async function handleListClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const li = el.closest(".task");
    const id = li.dataset.id;
    const action = el.dataset.action;
    const t = tasks.find((x) => x.id === id);

    if (action === "toggle") {
      await updateTask(id, { done: !t.done });
      await refresh();
    } else if (action === "del") {
      if (confirm("确定删除该任务吗？")) {
        await deleteTask(id);
        await refresh();
      }
    } else if (action === "edit") {
      openModal(t);
    }
  }

  taskList.addEventListener("click", handleListClick);
  weeklyList.addEventListener("click", handleListClick);

  // 筛选按钮
  document.querySelectorAll(".filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      render();
    });
  });

  categoryFilter.addEventListener("change", () => {
    currentCategory = categoryFilter.value;
    render();
  });

  // ---------- 编辑弹窗 ----------
  let editingId = null;

  function openModal(t) {
    editingId = t.id;
    $("#editTitle").value = t.title;
    $("#editNote").value = t.note || "";
    $("#editPriority").value = t.priority || "中";
    $("#editDue").value = t.due || "";
    $("#editCategory").value = t.category || "";
    $("#modal").style.display = "flex";
  }

  function closeModal() {
    $("#modal").style.display = "none";
    editingId = null;
  }

  $("#cancelBtn").addEventListener("click", closeModal);
  $("#modal").addEventListener("click", (e) => {
    if (e.target === $("#modal")) closeModal();
  });

  $("#editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#editTitle").value.trim();
    if (!title) return;
    await updateTask(editingId, {
      title,
      note: $("#editNote").value,
      priority: $("#editPriority").value,
      due: $("#editDue").value,
      category: $("#editCategory").value.trim(),
    });
    closeModal();
    await refresh();
  });

  // ---------- 初始化 ----------
  async function refresh() {
    tasks = await getTasks();
    render();
  }

  refresh().catch((err) => {
    empty.style.display = "block";
    empty.textContent = "加载失败: " + err.message;
  });
})();
