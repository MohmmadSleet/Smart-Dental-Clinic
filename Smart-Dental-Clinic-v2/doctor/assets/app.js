document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("[data-year]")
    .forEach((x) => (x.textContent = new Date().getFullYear()));
  const toastEl = document.getElementById("appToast");
  const showToast = (msg) => {
    if (!toastEl) return;
    toastEl.querySelector(".toast-body").textContent = msg;
    bootstrap.Toast.getOrCreateInstance(toastEl).show();
  };
  document
    .querySelectorAll("[data-toast]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        showToast(el.dataset.toast || "تمت العملية تجريبياً"),
      ),
    );
  document
    .querySelectorAll("[data-logout]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        showToast("تسجيل الخروج تجريبي في نسخة الواجهات"),
      ),
    );
  document
    .querySelectorAll("[data-language]")
    .forEach((el) =>
      el.addEventListener("click", () =>
        showToast("تغيير اللغة سيكون فعالاً عند ربط النظام لاحقاً"),
      ),
    );

  // Generic filters
  function wireFilter(searchId, filterId, itemSelector) {
    const s = document.getElementById(searchId),
      f = document.getElementById(filterId),
      items = [...document.querySelectorAll(itemSelector)];
    const run = () => {
      const q = (s?.value || "").trim().toLowerCase(),
        st = f?.value || "all";
      items.forEach((it) => {
        const okQ = !q || (it.dataset.search || "").toLowerCase().includes(q);
        const okS = st === "all" || it.dataset.status === st;
        it.classList.toggle("d-none", !(okQ && okS));
      });
    };
    s?.addEventListener("input", run);
    f?.addEventListener("change", run);
  }
  wireFilter(
    "appointmentSearch",
    "appointmentFilter",
    ".appointment-filter-item",
  );
  wireFilter("patientSearch", "patientFilter", ".patient-filter-item");
  wireFilter("reportSearch", "reportFilter", ".report-filter-item");
  wireFilter("followupSearch", "followupFilter", ".followup-filter-item");

  // Odontogram
  const selectedTooth = document.getElementById("selectedTooth");
  const selectedState = document.getElementById("selectedToothState");
  let currentTooth = null;
  const stateLabels = {
    healthy: "سليم",
    caries: "تسوس",
    filling: "حشوة",
    root: "علاج جذور",
    crown: "تاج",
    missing: "مفقود",
  };
  document.querySelectorAll(".tooth").forEach((btn) =>
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tooth")
        .forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      currentTooth = btn;
      if (selectedTooth) selectedTooth.textContent = btn.dataset.tooth;
      if (selectedState)
        selectedState.textContent =
          stateLabels[btn.dataset.state || "healthy"] || "سليم";
    }),
  );
  document.querySelectorAll("[data-tooth-state]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (!currentTooth) {
        showToast("اختر السن أولاً");
        return;
      }
      currentTooth.dataset.state = btn.dataset.toothState;
      currentTooth.querySelector(".tooth-icon").textContent =
        btn.dataset.icon || "🦷";
      if (selectedState)
        selectedState.textContent =
          stateLabels[btn.dataset.toothState] || btn.textContent.trim();
      showToast("تم تحديث حالة السن تجريبياً");
    }),
  );

  // Dynamic clinical rows
  function addRow(containerId, html) {
    const c = document.getElementById(containerId);
    if (!c) return;
    const d = document.createElement("div");
    d.className = "dynamic-list-item mt-2";
    d.innerHTML = html;
    c.appendChild(d);
    d.querySelector("[data-remove]")?.addEventListener("click", () =>
      d.remove(),
    );
  }
  document
    .getElementById("addDiagnosis")
    ?.addEventListener("click", () =>
      addRow(
        "diagnosisList",
        `<div class="row g-2 align-items-end"><div class="col-md-3"><label class="form-label small">السن</label><input class="form-control" placeholder="مثال 16"></div><div class="col-md-7"><label class="form-label small">التشخيص</label><input class="form-control" placeholder="اكتب التشخيص"></div><div class="col-md-2"><button class="btn btn-outline-danger w-100" data-remove>حذف</button></div></div>`,
      ),
    );
  // Treatment Plan stages: each stage has its own Edit/Save/Delete controls.
  const planSteps = document.getElementById("planSteps");

  function setPlanStepEditing(item, editing) {
    if (!item) return;
    item.dataset.stepEditing = editing ? "true" : "false";
    item.querySelectorAll("input[data-step-field]").forEach((input) => {
      if (editing) input.removeAttribute("readonly");
      else input.setAttribute("readonly", "");
    });
    item.querySelectorAll("select[data-step-field]").forEach((select) => {
      select.disabled = !editing;
    });
    const editBtn = item.querySelector("[data-step-edit]");
    if (editBtn) {
      editBtn.className = `btn btn-sm ${editing ? "btn-success" : "btn-outline-primary"}`;
      editBtn.innerHTML = editing
        ? '<i class="bi bi-check2 ms-1"></i>حفظ'
        : '<i class="bi bi-pencil-square ms-1"></i>تعديل';
    }
    item.classList.toggle("is-editing", editing);
  }

  function validatePlanStep(item) {
    const tooth = item.querySelector("input[data-step-field]")?.value.trim();
    const treatment = item
      .querySelectorAll("input[data-step-field]")[1]
      ?.value.trim();
    if (!tooth) {
      showToast("اكتب رقم السن للمرحلة.");
      return false;
    }
    if (!treatment) {
      showToast("اكتب اسم المرحلة / العلاج.");
      return false;
    }
    return true;
  }

  function createPlanStep() {
    if (!planSteps) return;
    const d = document.createElement("div");
    d.className = "dynamic-list-item plan-step-item is-editing mt-2";
    d.dataset.planStep = "";
    d.dataset.stepSaved = "false";
    d.dataset.stepEditing = "true";
    d.innerHTML = `
      <div class="row g-2 align-items-end">
        <div class="col-md-2">
          <label class="form-label small">السن</label>
          <input class="form-control" data-step-field placeholder="46">
        </div>
        <div class="col-md-5">
          <label class="form-label small">المرحلة / العلاج</label>
          <input class="form-control" data-step-field placeholder="مثال: حشو الجذور">
        </div>
        <div class="col-md-2">
          <label class="form-label small">الحالة</label>
          <select class="form-select" data-step-field>
            <option>مخطط</option>
            <option>قادم</option>
            <option>مكتمل</option>
          </select>
        </div>
        <div class="col-md-3" data-step-actions>
          <label class="form-label small d-block">الإجراءات</label>
          <div class="d-grid grid-template-columns-2 gap-2 plan-step-actions">
            <button class="btn btn-success btn-sm" type="button" data-step-edit><i class="bi bi-check2 ms-1"></i>حفظ</button>
            <button class="btn btn-outline-danger btn-sm" type="button" data-step-delete><i class="bi bi-trash3 ms-1"></i>حذف</button>
          </div>
        </div>
      </div>`;
    planSteps.appendChild(d);
    d.querySelector("input")?.focus();
  }

  document
    .getElementById("addPlanStep")
    ?.addEventListener("click", createPlanStep);

  planSteps?.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-step-edit]");
    const deleteBtn = e.target.closest("[data-step-delete]");
    const item = e.target.closest("[data-plan-step]");
    if (!item) return;

    if (editBtn) {
      const editing = item.dataset.stepEditing === "true";
      if (editing) {
        if (!validatePlanStep(item)) return;
        item.dataset.stepSaved = "true";
        setPlanStepEditing(item, false);
        showToast("تم حفظ تعديل مرحلة خطة العلاج تجريبياً");
      } else {
        setPlanStepEditing(item, true);
        item.querySelector("input[data-step-field]")?.focus();
      }
    }

    if (deleteBtn) {
      const treatment =
        item.querySelectorAll("input[data-step-field]")[1]?.value.trim() ||
        "هذه المرحلة";
      if (window.confirm(`حذف مرحلة "${treatment}" من خطة العلاج؟`)) {
        item.remove();
        showToast("تم حذف مرحلة خطة العلاج تجريبياً");
      }
    }
  });

  // Existing saved stages start locked until Edit is clicked.
  planSteps?.querySelectorAll("[data-plan-step]").forEach((item) => {
    if (item.dataset.stepSaved !== "false") setPlanStepEditing(item, false);
  });
  document
    .getElementById("addMedication")
    ?.addEventListener("click", () =>
      addRow(
        "medicationList",
        `<div class="row g-2 align-items-end"><div class="col-md-3"><label class="form-label small">الدواء</label><input class="form-control" placeholder="اسم الدواء"></div><div class="col-md-2"><label class="form-label small">الجرعة</label><input class="form-control" placeholder="500 mg"></div><div class="col-md-3"><label class="form-label small">التكرار</label><input class="form-control" placeholder="3 مرات يومياً"></div><div class="col-md-2"><label class="form-label small">المدة</label><input class="form-control" placeholder="5 أيام"></div><div class="col-md-2"><button class="btn btn-outline-danger w-100" data-remove>حذف</button></div></div>`,
      ),
    );

  // Attachment mock
  document
    .getElementById("attachmentInput")
    ?.addEventListener("change", (e) => {
      const files = [...e.target.files];
      const c = document.getElementById("attachmentList");
      files.forEach((file) => {
        const d = document.createElement("div");
        d.className =
          "attachment-item mt-2 d-flex justify-content-between gap-2 align-items-center";
        d.innerHTML = `<div><i class="bi bi-paperclip ms-1"></i><strong>${file.name}</strong><div class="small text-secondary">مرفق جديد — عرض تجريبي</div></div><button class="btn btn-sm btn-light">إزالة</button>`;
        d.querySelector("button").onclick = () => d.remove();
        c.appendChild(d);
      });
    });

  // Toggles
  const labToggle = document.getElementById("needsLab"),
    labFields = document.getElementById("labFields");
  const syncLab = () =>
    labFields?.classList.toggle("d-none", !labToggle?.checked);
  labToggle?.addEventListener("change", syncLab);
  syncLab();
  const followToggle = document.getElementById("needsFollowup"),
    followFields = document.getElementById("followupFields");
  const syncFollow = () =>
    followFields?.classList.toggle("d-none", !followToggle?.checked);
  followToggle?.addEventListener("change", syncFollow);
  syncFollow();

  document
    .getElementById("saveVisitDraft")
    ?.addEventListener("click", () =>
      showToast("تم حفظ مسودة الزيارة تجريبياً بدون تخزين فعلي"),
    );
  document.getElementById("finishVisit")?.addEventListener("click", () => {
    const modal = document.getElementById("finishVisitModal");
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).show();
  });

  // Mark lab as installed
  document.querySelectorAll("[data-mark-installed]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const row = btn.closest("[data-lab-row]");
      const badge = row?.querySelector("[data-lab-status]");
      if (row) row.dataset.status = "installed";
      if (badge) {
        badge.textContent = "تم التركيب للمريض";
        badge.className = "badge text-bg-dark";
        badge.setAttribute("data-lab-status", "");
      }
      btn.disabled = true;
      btn.textContent = "تم التركيب";
      showToast("تم تسجيل التركيب للمريض تجريبياً");
    }),
  );
});

// =========================================================
// Doctor v5 — FINAL viewport-safe popovers
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const EDGE = 12;
  const GAP = 8;

  const triggers = [...document.querySelectorAll("[data-ui-popover]")];

  // Portal menus to BODY so navbar/RTL/overflow can never affect positioning.
  const popovers = [];
  triggers.forEach((trigger) => {
    const id = trigger.getAttribute("data-ui-popover");
    const pop = document.getElementById(id);
    if (!pop) return;

    if (pop.parentElement !== document.body) {
      document.body.appendChild(pop);
    }
    if (!popovers.includes(pop)) popovers.push(pop);
  });

  function viewportMetrics() {
    // visualViewport is safer on mobile browser zoom / browser chrome.
    const vv = window.visualViewport;
    return {
      width:
        vv?.width || document.documentElement.clientWidth || window.innerWidth,
      height:
        vv?.height ||
        document.documentElement.clientHeight ||
        window.innerHeight,
      offsetLeft: vv?.offsetLeft || 0,
      offsetTop: vv?.offsetTop || 0,
    };
  }

  function closeAll(exceptId = null) {
    popovers.forEach((pop) => {
      if (!exceptId || pop.id !== exceptId) {
        pop.classList.remove("is-open");
      }
    });
  }

  function setImportant(el, prop, value) {
    el.style.setProperty(prop, value, "important");
  }

  function positionPopover(trigger, pop) {
    const vp = viewportMetrics();
    const rect = trigger.getBoundingClientRect();
    const mobile = vp.width < 768;

    const requestedWidth = mobile
      ? vp.width - EDGE * 2
      : pop.classList.contains("doctor-profile-popover")
        ? 290
        : 360;

    const width = Math.max(180, Math.min(requestedWidth, vp.width - EDGE * 2));

    setImportant(pop, "width", `${width}px`);
    setImportant(pop, "max-width", `${vp.width - EDGE * 2}px`);

    // Align the menu's RIGHT edge with the button's right edge on desktop.
    // On mobile, use equal margins.
    let left = mobile
      ? vp.offsetLeft + EDGE
      : vp.offsetLeft + rect.right - width;

    const minLeft = vp.offsetLeft + EDGE;
    const maxLeft = vp.offsetLeft + vp.width - width - EDGE;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    let top = vp.offsetTop + rect.bottom + GAP;

    // Temporarily make visible to measure actual content height.
    pop.classList.add("is-open");
    setImportant(pop, "visibility", "hidden");
    setImportant(pop, "left", `${left}px`);
    setImportant(pop, "top", `${top}px`);
    setImportant(pop, "right", "auto");
    setImportant(pop, "bottom", "auto");
    setImportant(pop, "transform", "none");

    const measuredHeight = Math.min(
      pop.scrollHeight || 0,
      vp.height - EDGE * 2,
    );

    const availableBelow = vp.offsetTop + vp.height - top - EDGE;
    const availableAbove = rect.top - EDGE;

    if (measuredHeight > availableBelow && availableAbove > availableBelow) {
      top = vp.offsetTop + rect.top - GAP - measuredHeight;
    }

    const minTop = vp.offsetTop + EDGE;
    const maxTop = vp.offsetTop + vp.height - measuredHeight - EDGE;
    top = Math.max(minTop, Math.min(top, Math.max(minTop, maxTop)));

    setImportant(pop, "left", `${left}px`);
    setImportant(pop, "top", `${top}px`);
    setImportant(pop, "max-height", `${vp.height - EDGE * 2}px`);
    pop.style.removeProperty("visibility");

    // Safety verification: after layout, hard-correct any pixel overflow.
    requestAnimationFrame(() => {
      const r = pop.getBoundingClientRect();
      let correctedLeft = parseFloat(pop.style.left) || left;
      let correctedTop = parseFloat(pop.style.top) || top;

      if (r.left < EDGE) correctedLeft += EDGE - r.left;
      if (r.right > vp.width - EDGE)
        correctedLeft -= r.right - (vp.width - EDGE);
      if (r.top < EDGE) correctedTop += EDGE - r.top;
      if (r.bottom > vp.height - EDGE)
        correctedTop -= r.bottom - (vp.height - EDGE);

      setImportant(pop, "left", `${Math.max(EDGE, correctedLeft)}px`);
      setImportant(pop, "top", `${Math.max(EDGE, correctedTop)}px`);
    });
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();

      const id = trigger.getAttribute("data-ui-popover");
      const pop = document.getElementById(id);
      if (!pop) return;

      const wasOpen = pop.classList.contains("is-open");
      closeAll();

      if (!wasOpen) {
        positionPopover(trigger, pop);
        pop.classList.add("is-open");
      }
    });
  });

  popovers.forEach((pop) => {
    pop.addEventListener("click", (event) => event.stopPropagation());
  });

  document.addEventListener("click", () => closeAll());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });

  window.addEventListener("resize", () => closeAll());
  window.addEventListener("scroll", () => closeAll(), { passive: true });
  window.visualViewport?.addEventListener("resize", () => closeAll());
  window.visualViewport?.addEventListener("scroll", () => closeAll());
});

// =========================================================
// System-wide mobile table enhancement.
// Adds header labels to cells so every table becomes a card list on phones.
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll("table:not([data-no-mobile-stack])")
    .forEach((table) => {
      table.classList.add("responsive-stack-table");

      const wrapper = table.closest(".table-responsive");
      if (wrapper) wrapper.classList.add("mobile-stack-wrapper");

      let headers = [...table.querySelectorAll("thead tr:first-child th")].map(
        (th) => th.textContent.replace(/\s+/g, " ").trim(),
      );

      // Fallback for tables without a formal THEAD.
      if (!headers.length) {
        const firstRow = table.querySelector("tr");
        if (firstRow) {
          headers = [...firstRow.children]
            .filter((cell) => cell.tagName === "TH")
            .map((th) => th.textContent.replace(/\s+/g, " ").trim());
        }
      }

      table.querySelectorAll("tbody tr").forEach((row) => {
        [...row.children].forEach((cell, index) => {
          if (cell.tagName !== "TD") return;
          if (cell.hasAttribute("colspan")) {
            cell.dataset.label = "";
            return;
          }
          if (!cell.dataset.label) {
            cell.dataset.label = headers[index] || "";
          }
        });
      });
    });
});

// =========================================================
// Dynamic-row mobile table observer.
// Keeps rows added by front-end demo actions responsive on phones.
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const relabel = (table) => {
    if (!table || table.hasAttribute("data-no-mobile-stack")) return;
    table.classList.add("responsive-stack-table");
    table.closest(".table-responsive")?.classList.add("mobile-stack-wrapper");

    const headers = [...table.querySelectorAll("thead tr:first-child th")].map(
      (th) => th.textContent.replace(/\s+/g, " ").trim(),
    );

    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName !== "TD") return;
        cell.dataset.label = cell.hasAttribute("colspan")
          ? ""
          : headers[index] || "";
      });
    });
  };

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches("table")) relabel(node);
        node.querySelectorAll?.("table").forEach(relabel);
        const parentTable = node.closest?.("table");
        if (parentTable) relabel(parentTable);
      });
    });
  });

  document.querySelectorAll("table").forEach(relabel);
  observer.observe(document.body, { childList: true, subtree: true });
});

// =========================================================
// V5 Table UI decorator — consistent tables across all roles.
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const decorateTable = (table) => {
    if (!table || table.hasAttribute("data-no-table-ui")) return;

    table.classList.add("system-data-table", "responsive-stack-table");
    const wrapper = table.closest(".table-responsive");
    if (wrapper)
      wrapper.classList.add("table-ui-shell", "mobile-stack-wrapper");

    const headers = [...table.querySelectorAll("thead tr:first-child th")].map(
      (th, i) => {
        const value = th.textContent.replace(/\s+/g, " ").trim();
        if (
          !value &&
          i === table.querySelectorAll("thead tr:first-child th").length - 1
        ) {
          th.textContent = "الإجراءات";
          return "الإجراءات";
        }
        return value;
      },
    );

    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = [...row.children].filter((c) => c.tagName === "TD");
      cells.forEach((cell, index) => {
        cell.dataset.label = cell.hasAttribute("colspan")
          ? ""
          : headers[index] || "";
        cell.classList.toggle(
          "table-primary-cell",
          index === 0 && !cell.hasAttribute("colspan"),
        );

        const hasStatusBadge = !!cell.querySelector(
          '.badge[class*="text-bg-"], .badge[class*="badge-soft"]',
        );
        if (hasStatusBadge && index !== 0)
          cell.classList.add("table-status-cell");

        const hasActions = !!cell.querySelector("button, a.btn, .dropdown");
        if (hasActions && index === cells.length - 1)
          cell.classList.add("table-actions-cell");
      });
    });
  };

  document.querySelectorAll("table").forEach(decorateTable);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.("table")) decorateTable(node);
        node.querySelectorAll?.("table").forEach(decorateTable);
        const table = node.closest?.("table");
        if (table) decorateTable(table);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
});

// =========================================================
// V6 Global action-group decorator
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const decorateActions = () => {
    document.querySelectorAll(".appointment-item .row").forEach((row) => {
      [...row.children].forEach((col) => {
        const actions = [
          ...col.querySelectorAll(
            ":scope > .btn, :scope > a.btn, :scope > button.btn",
          ),
        ];
        if (actions.length >= 2) col.classList.add("card-action-group");
      });
    });
    document
      .querySelectorAll("table.system-data-table tbody tr")
      .forEach((row) => {
        const cells = [...row.children].filter((x) => x.tagName === "TD");
        const last = cells[cells.length - 1];
        if (last && last.querySelector("button,a.btn")) {
          last.classList.add("table-actions-cell");
          const wrap = last.querySelector(":scope > .d-flex");
          if (wrap) wrap.classList.add("table-action-grid");
        }
      });
  };
  decorateActions();
  new MutationObserver(decorateActions).observe(document.body, {
    childList: true,
    subtree: true,
  });
});

// V6 appointment meta blocks
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".appointment-item .row").forEach((row) => {
    const cols = [...row.children];
    cols.forEach((col, i) => {
      if (
        i > 0 &&
        !col.classList.contains("card-action-group") &&
        !col.querySelectorAll(
          ":scope > .btn,:scope > a.btn,:scope > button.btn",
        ).length
      ) {
        col.classList.add("entity-meta-block");
      }
    });
  });
});

// =========================================================
// V11 wide-table classifier: removes horizontal scrolling by
// switching 6/7+ column tables to responsive card grids.
// =========================================================
document.addEventListener("DOMContentLoaded", () => {
  const classifyWideTable = (table) => {
    if (!table || table.hasAttribute("data-no-responsive-cards")) return;
    const headers = [...table.querySelectorAll("thead tr:first-child th")];
    const count = headers.length;
    table.classList.toggle("wide-data-table", count >= 7);
    table.classList.toggle("medium-data-table", count === 6);
  };

  document.querySelectorAll("table").forEach(classifyWideTable);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) =>
      m.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches?.("table")) classifyWideTable(node);
        node.querySelectorAll?.("table").forEach(classifyWideTable);
        const parent = node.closest?.("table");
        if (parent) classifyWideTable(parent);
      }),
    );
  });
  observer.observe(document.body, { childList: true, subtree: true });
});


// Doctor lab cases filters
document.addEventListener("DOMContentLoaded", () => {
  const q = document.getElementById("doctorLabSearch");
  const lab = document.getElementById("doctorLabFilter");
  const status = document.getElementById("doctorLabStatus");
  const rows = [...document.querySelectorAll("[data-lab-row]")];
  const empty = document.getElementById("doctorLabEmpty");
  const run = () => {
    if (!rows.length) return;
    const term=(q?.value||"").trim().toLowerCase(), l=lab?.value||"all", st=status?.value||"all";
    let visible=0;
    rows.forEach((row)=>{const show=(!term||(row.dataset.search||row.textContent).toLowerCase().includes(term))&&(l==="all"||row.dataset.lab===l)&&(st==="all"||row.dataset.status===st); row.classList.toggle("d-none",!show); if(show)visible++;});
    empty?.classList.toggle("d-none", visible!==0);
  };
  q?.addEventListener("input",run); lab?.addEventListener("change",run); status?.addEventListener("change",run); run();
});


document.addEventListener("DOMContentLoaded", () => {
  // Treatment plans list filters (shared demo behavior)
  const search = document.getElementById("treatmentPlanSearch");
  const status = document.getElementById("treatmentPlanStatus");
  const doctor = document.getElementById("treatmentPlanDoctor");
  const progress = document.getElementById("treatmentPlanProgress");
  const clear = document.getElementById("clearTreatmentPlanFilters");
  const empty = document.getElementById("treatmentPlanEmpty");
  const items = [...document.querySelectorAll(".treatment-plan-filter-item")];
  if (!items.length) return;

  const normPlan = (v) => (v || "").toString().trim().toLowerCase();
  function applyTreatmentPlanFilters() {
    const q = normPlan(search?.value);
    const wantedStatus = status?.value || "all";
    const wantedDoctor = doctor?.value || "all";
    const wantedProgress = progress?.value || "all";
    let visible = 0;
    items.forEach((item) => {
      const itemProgress = Number(item.dataset.progress || 0);
      const matchSearch = !q || normPlan(item.dataset.search).includes(q);
      const matchStatus = wantedStatus === "all" || item.dataset.status === wantedStatus;
      const matchDoctor = wantedDoctor === "all" || item.dataset.doctor === wantedDoctor;
      const matchProgress = wantedProgress === "all" || (wantedProgress === "low" ? itemProgress < 50 : itemProgress >= 50);
      const show = matchSearch && matchStatus && matchDoctor && matchProgress;
      item.classList.toggle("d-none", !show);
      if (show) visible++;
    });
    empty?.classList.toggle("d-none", visible !== 0);
  }
  search?.addEventListener("input", applyTreatmentPlanFilters);
  status?.addEventListener("change", applyTreatmentPlanFilters);
  doctor?.addEventListener("change", applyTreatmentPlanFilters);
  progress?.addEventListener("change", applyTreatmentPlanFilters);
  clear?.addEventListener("click", () => {
    if (search) search.value = "";
    if (status) status.value = "all";
    if (doctor) doctor.value = "all";
    if (progress) progress.value = "all";
    applyTreatmentPlanFilters();
  });
});

// Front-end prototype: create/open treatment plans without backend persistence.
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("createTreatmentPlanForm");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const patient = document.getElementById("newPlanPatient");
    const selected = patient?.selectedOptions?.[0];
    const patientKey = patient?.value || "";
    const patientName = selected?.dataset.name || "";
    const code = selected?.dataset.code || "";
    const name = document.getElementById("newPlanName")?.value.trim() || "";
    const status = document.getElementById("newPlanStatus")?.value || "active";
    const cost = document.getElementById("newPlanCost")?.value.trim() || "";
    const tooth = document.getElementById("newPlanTooth")?.value.trim() || "—";
    const step = document.getElementById("newPlanFirstStep")?.value.trim() || "";
    const notes = document.getElementById("newPlanNotes")?.value.trim() || "";
    if (!patientKey || !name || !step) {
      const el = document.getElementById("appToast");
      if (el) {
        const b = el.querySelector(".toast-body");
        if (b) b.textContent = "اختر المريض واكتب اسم الخطة وأول مرحلة.";
        bootstrap.Toast.getOrCreateInstance(el).show();
      }
      return;
    }
    const q = new URLSearchParams({
      plan: "new",
      patient: patientKey,
      patientName,
      code,
      name,
      status,
      cost,
      tooth,
      step,
      notes,
    });
    window.location.href = `treatment-plan-details.html?${q.toString()}`;
  });

  const page = document.getElementById("treatmentPlanDetailPage");
  if (!page) return;
  const params = new URLSearchParams(location.search);
  const key = params.get("plan") || "ahmad";
  const catalog = document.getElementById("treatmentPlanCatalog");
  let record = catalog?.querySelector(`[data-plan-record="${CSS.escape(key)}"]`);
  const isNew = key === "new";

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "—";
  };
  const statusMeta = (status) => {
    if (status === "completed") return ["مكتملة", "text-bg-success"];
    if (status === "paused") return ["متوقفة", "text-bg-warning"];
    return ["نشطة", "text-bg-primary"];
  };
  const stepMarkup = (tooth, treatment, state) => {
    const options = ["مخطط", "قادم", "مكتمل"]
      .map((x) => `<option${x === state ? " selected" : ""}>${x}</option>`)
      .join("");
    return `<div class="dynamic-list-item plan-step-item" data-plan-step data-step-saved="true">
      <div class="row g-2 align-items-end">
        <div class="col-md-2"><label class="form-label small">السن</label><input class="form-control" data-step-field readonly value="${tooth || "—"}"></div>
        <div class="col-md-5"><label class="form-label small">المرحلة / العلاج</label><input class="form-control" data-step-field readonly value="${treatment || ""}"></div>
        <div class="col-md-2"><label class="form-label small">الحالة</label><select class="form-select" data-step-field disabled>${options}</select></div>
        <div class="col-md-3" data-step-actions><label class="form-label small d-block">الإجراءات</label><div class="d-grid grid-template-columns-2 gap-2 plan-step-actions"><button class="btn btn-outline-primary btn-sm" data-step-edit type="button"><i class="bi bi-pencil-square ms-1"></i>تعديل</button><button class="btn btn-outline-danger btn-sm" data-step-delete type="button"><i class="bi bi-trash3 ms-1"></i>حذف</button></div></div>
      </div></div>`;
  };

  let data;
  let steps = [];
  if (isNew) {
    const status = params.get("status") || "active";
    const [statusLabel] = statusMeta(status);
    data = {
      title: params.get("name") || "خطة علاج جديدة",
      patient: params.get("patientName") || "المريض",
      patientKey: params.get("patient") || "ahmad",
      code: params.get("code") || "—",
      doctor: page.dataset.currentDoctor || "—",
      status,
      statusLabel,
      progress: "0",
      start: "اليوم",
      cost: params.get("cost") ? `${params.get("cost")} ₪` : "غير محددة",
      next: "يُحدد بعد حفظ مراحل الخطة",
      updated: "خطة جديدة ضمن العرض الحالي.",
      notes: params.get("notes") || "",
    };
    steps = [{ tooth: params.get("tooth") || "—", treatment: params.get("step") || "المرحلة الأولى", state: "مخطط" }];
  } else if (record) {
    data = { ...record.dataset };
    steps = [...record.querySelectorAll("[data-plan-record-step]")].map((x) => ({ tooth: x.dataset.tooth, treatment: x.dataset.treatment, state: x.dataset.state }));
  } else {
    record = catalog?.querySelector('[data-plan-record="ahmad"]');
    data = record ? { ...record.dataset } : {};
    steps = record ? [...record.querySelectorAll("[data-plan-record-step]")].map((x) => ({ tooth: x.dataset.tooth, treatment: x.dataset.treatment, state: x.dataset.state })) : [];
  }

  const progress = Number(data.progress || 0);
  const [statusLabel, badgeClass] = statusMeta(data.status);
  setText("planTitle", data.title);
  setText("planBreadcrumbTitle", data.title);
  setText("planPatientBreadcrumb", data.patient);
  setText("planSubtitle", `خطة المريض ${data.patient} • ${data.code || "—"} • ${data.doctor || page.dataset.currentDoctor || "—"}`);
  setText("planProgressValue", `${progress}%`);
  setText("planProgressStrong", `${progress}%`);
  setText("planStartDate", data.start || "—");
  setText("planEstimatedCost", data.cost || "—");
  setText("planNextAppointment", data.next || "—");
  setText("planLastUpdate", data.updated || "—");
  const badge = document.getElementById("planStatusBadge");
  if (badge) { badge.textContent = data.statusLabel || statusLabel; badge.className = `badge ${badgeClass} fs-6`; }
  const bar = document.getElementById("planProgressBar");
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  const notes = document.getElementById("planNotes");
  if (notes) notes.value = data.notes || "";
  const patientHref = `patient-details.html?patient=${encodeURIComponent(data.patientKey || "ahmad")}`;
  const pl = document.getElementById("planPatientLink"); if (pl) pl.href = patientHref;
  const pcl = document.getElementById("planPatientBreadcrumbLink"); if (pcl) pcl.href = patientHref;
  const stepsEl = document.getElementById("planSteps");
  if (stepsEl) stepsEl.innerHTML = steps.map((x) => stepMarkup(x.tooth, x.treatment, x.state)).join("");
});


// HTML-only detail catalogs for patient/report prototypes
document.addEventListener("DOMContentLoaded",()=>{
  if(document.querySelector("[data-doctor-patient-details]")){const id=new URLSearchParams(location.search).get("patient")||"ahmad",r=[...document.querySelectorAll("[data-doctor-patient-record]")].find(x=>x.dataset.id===id)||document.querySelector("[data-doctor-patient-record]");if(r){const set=(i,v)=>{const e=document.getElementById(i);if(e)e.textContent=v||"—"};set("doctorPatientBreadcrumb",r.dataset.name);set("doctorPatientAvatar",r.dataset.avatar);set("doctorPatientName",r.dataset.name);set("doctorPatientMeta",`${r.dataset.code} • ${r.dataset.age} • ${r.dataset.phone}`);set("doctorPatientBlood",r.dataset.blood);set("doctorPatientAllergy",r.dataset.allergy);set("doctorPatientChronic",r.dataset.chronic);set("doctorPatientMeds",r.dataset.meds);set("doctorPatientNotes",r.dataset.notes);const plan=document.getElementById("doctorPatientPlanLink");if(plan&&r.dataset.plan)plan.href=`treatment-plan-details.html?plan=${encodeURIComponent(r.dataset.plan)}`;
    const ptitle=document.getElementById("doctorPatientPlanTitle"),pstatus=document.getElementById("doctorPatientPlanStatus"),pbar=document.getElementById("doctorPatientPlanBar"),pinfo=document.getElementById("doctorPatientPlanInfo");if(ptitle)ptitle.textContent=r.dataset.planTitle||"—";if(pstatus)pstatus.textContent=r.dataset.planStatus||"—";if(pbar)pbar.style.width=`${Number(r.dataset.planProgress||0)}%`;if(pinfo)pinfo.textContent=r.dataset.planInfo||"—";if(plan)plan.classList.toggle("d-none",!r.dataset.plan);document.querySelectorAll("[data-plan-ahmad-detail]").forEach(el=>el.classList.toggle("d-none",id!=="ahmad"));
    const vb=document.getElementById("doctorPatientVisitsBody"),vr=document.querySelector(`[data-doctor-visits-record][data-patient="${CSS.escape(id)}"]`);if(vb&&vr){vb.innerHTML=[...vr.querySelectorAll("[data-visit]")].map(v=>`<tr><td data-label="التاريخ">${v.dataset.date}</td><td data-label="الطبيب">${v.dataset.doctor}</td><td data-label="الخدمة">${v.dataset.service}</td><td data-label="التشخيص / الملخص">${v.dataset.summary}</td><td data-label="الإجراء">${v.dataset.action==="visit"?'<a class="btn btn-sm btn-primary" href="visit.html">الزيارة الحالية</a>':`<a class="btn btn-sm btn-outline-primary" href="report-details.html?report=${v.dataset.report||"rpt014"}">عرض التقرير</a>`}</td></tr>`).join("");}}}
  if(document.querySelector("[data-doctor-report-details]")){const id=new URLSearchParams(location.search).get("report")||"rpt014",r=[...document.querySelectorAll("[data-doctor-report-record]")].find(x=>x.dataset.id===id)||document.querySelector("[data-doctor-report-record]");if(r){const map={doctorReportCode:"code",doctorReportDate:"date",doctorReportVisit:"visit",doctorReportPatient:"patient",doctorReportPatientCode:"patientCode",doctorReportDoctor:"doctor",doctorReportSpecialty:"specialty",doctorReportService:"service",doctorReportTooth:"tooth",doctorReportReason:"reason",doctorReportExam:"exam",doctorReportDiagnosis:"diagnosis",doctorReportTreatment:"treatment",doctorReportPlan1:"plan1",doctorReportPlan2:"plan2",doctorReportPlan3:"plan3",doctorReportAttachment1:"attachment1",doctorReportAttachment2:"attachment2",doctorReportFollowType:"followType",doctorReportFollowDate:"followDate",doctorReportApprovedAt:"approvedAt"};Object.entries(map).forEach(([i,k])=>{const e=document.getElementById(i);if(e)e.textContent=r.dataset[k]||"—"});const back=document.querySelector('.report-page-toolbar a[href^="patient-details.html"]');if(back)back.href=`patient-details.html?patient=${r.dataset.patientKey||"ahmad"}`;}}
});
