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

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------- 渲染 ----------
  function render() {
    const categories = [...new Set(tasks.map((t) => t.category).filter(Boolean))];
    const current = categoryFilter.value;
    categoryFilter.innerHTML =
      '<option value="">全部分类</option>' +
      categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    categoryFilter.value = categories.includes(current) ? current : "";

    let list = tasks.slice();
    if (currentFilter === "active") list = list.filter((t) => !t.done);
    else if (currentFilter === "done") list = list.filter((t) => t.done);
    else if (currentFilter === "overdue") list = list.filter(isOverdue);
    if (categoryFilter.value) list = list.filter((t) => t.category === categoryFilter.value);

    // 排序：未完成在前，按优先级、截止日期
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
    const overdue = tasks.filter(isOverdue).length;
    stat.textContent = `共 ${tasks.length} 项 · 已完成 ${done} 项 · 已逾期 ${overdue} 项`;
  }

  function taskCard(t) {
    const overdue = isOverdue(t);
    const priClass = t.priority === "高" ? "high" : t.priority === "低" ? "low" : "mid";
    const dueStr = t.due ? (overdue ? "已逾期 · " : "截止 ") + t.due : "";

    let meta = `<span class="badge ${priClass}">${escapeHtml(t.priority)}</span>`;
    if (t.category) meta += `<span class="badge cat">${escapeHtml(t.category)}</span>`;
    if (t.due)
      meta += `<span class="badge ${overdue ? "overdue" : ""}">${escapeHtml(dueStr)}</span>`;

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
    const body = {
      title,
      priority: $("#priorityInput").value,
      due: $("#dueInput").value,
      category: $("#categoryInput").value.trim(),
      created: new Date().toLocaleString("zh-CN"),
    };
    await createTask(body);
    $("#titleInput").value = "";
    $("#categoryInput").value = "";
    await refresh();
  });

  taskList.addEventListener("click", async (e) => {
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
  });

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
