document.addEventListener("DOMContentLoaded", () => {
  const norm = (v) => (v || "").toString().trim().toLowerCase();

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  function toast(message) {
    const el = document.getElementById("appToast");
    if (!el) return;
    const body = el.querySelector(".toast-body");
    if (body) body.textContent = message;
    bootstrap.Toast.getOrCreateInstance(el).show();
  }

  document.querySelectorAll("[data-toast]").forEach((btn) => {
    btn.addEventListener("click", () =>
      toast(btn.dataset.toast || "تمت العملية تجريبياً"),
    );
  });

  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", () => toast("تم تسجيل الخروج تجريبياً"));
  });

  document.querySelectorAll("[data-language]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll("[data-language]")
        .forEach((x) => x.classList.remove("active"));
      document
        .querySelectorAll(`[data-language="${btn.dataset.language}"]`)
        .forEach((x) => x.classList.add("active"));
      toast(
        btn.dataset.language === "en"
          ? "تم اختيار English — سيتم ربط الترجمة الكاملة لاحقاً."
          : "تم اختيار العربية.",
      );
    });
  });

  // Appointment filtering
  const appointmentSearch = document.getElementById("appointmentSearch");
  const appointmentItems = [...document.querySelectorAll(".appointment-item")];
  const appointmentButtons = [
    ...document.querySelectorAll("[data-appointment-filter]"),
  ];
  const appointmentCount = document.getElementById("appointmentCount");
  const appointmentEmpty = document.getElementById("appointmentEmpty");
  let appointmentFilter = "all";

  function filterAppointments() {
    if (!appointmentItems.length) return;
    const q = norm(appointmentSearch?.value);
    let visible = 0;

    appointmentItems.forEach((item) => {
      const status = item.dataset.status;
      const search = norm(item.dataset.search);
      let statusMatch = false;

      if (appointmentFilter === "all") statusMatch = true;
      else if (appointmentFilter === "pending")
        statusMatch = status === "pending";
      else if (appointmentFilter === "confirmed")
        statusMatch = status === "confirmed";
      else if (appointmentFilter === "reschedule")
        statusMatch = status === "reschedule";
      else if (appointmentFilter === "completed")
        statusMatch = status === "completed";
      else if (appointmentFilter === "closed")
        statusMatch = ["cancelled", "rejected"].includes(status);

      const show = statusMatch && (!q || search.includes(q));
      item.classList.toggle("d-none", !show);
      if (show) visible++;
    });

    if (appointmentCount) appointmentCount.textContent = `${visible} موعد`;
    appointmentEmpty?.classList.toggle("d-none", visible !== 0);
  }

  appointmentButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      appointmentButtons.forEach((x) => {
        x.classList.remove("btn-primary", "active");
        x.classList.add("btn-light");
      });
      btn.classList.remove("btn-light");
      btn.classList.add("btn-primary", "active");
      appointmentFilter = btn.dataset.appointmentFilter || "all";
      filterAppointments();
    });
  });
  appointmentSearch?.addEventListener("input", filterAppointments);

  // Doctor filtering
  const doctorSearch = document.getElementById("doctorSearch");
  const doctorSpecialty = document.getElementById("doctorSpecialty");
  const doctorAvailability = document.getElementById("doctorAvailability");
  const doctorItems = [...document.querySelectorAll(".doctor-item")];
  const doctorCount = document.getElementById("doctorCount");
  const doctorEmpty = document.getElementById("doctorEmpty");

  function filterDoctors() {
    if (!doctorItems.length) return;
    const q = norm(doctorSearch?.value);
    const specialty = doctorSpecialty?.value || "all";
    const availability = doctorAvailability?.value || "all";
    let visible = 0;

    doctorItems.forEach((item) => {
      const show =
        (!q ||
          norm(`${item.dataset.name} ${item.dataset.specialtyName}`).includes(
            q,
          )) &&
        (specialty === "all" || item.dataset.specialty === specialty) &&
        (availability === "all" || item.dataset.availability === availability);

      item.classList.toggle("d-none", !show);
      if (show) visible++;
    });

    if (doctorCount) doctorCount.textContent = `${visible} طبيب`;
    doctorEmpty?.classList.toggle("d-none", visible !== 0);
  }

  doctorSearch?.addEventListener("input", filterDoctors);
  doctorSpecialty?.addEventListener("change", filterDoctors);
  doctorAvailability?.addEventListener("change", filterDoctors);
  document
    .getElementById("clearDoctorFilters")
    ?.addEventListener("click", () => {
      if (doctorSearch) doctorSearch.value = "";
      if (doctorSpecialty) doctorSpecialty.value = "all";
      if (doctorAvailability) doctorAvailability.value = "all";
      filterDoctors();
    });

  // Services search/filter
  const serviceSearch = document.getElementById("serviceSearch");
  const serviceSpecialty = document.getElementById("serviceSpecialty");
  const serviceItems = [...document.querySelectorAll(".service-item")];

  function filterServices() {
    if (!serviceItems.length) return;
    const q = norm(serviceSearch?.value);
    const specialty = serviceSpecialty?.value || "all";

    serviceItems.forEach((item) => {
      const show =
        (!q ||
          norm(`${item.dataset.name} ${item.dataset.specialtyName}`).includes(
            q,
          )) &&
        (specialty === "all" || item.dataset.specialty === specialty);
      item.classList.toggle("d-none", !show);
    });
  }
  serviceSearch?.addEventListener("input", filterServices);
  serviceSpecialty?.addEventListener("change", filterServices);
});

document.addEventListener("DOMContentLoaded", () => {
  // Patients filtering
  const patientSearch = document.getElementById("patientSearch");
  const patientItems = [...document.querySelectorAll(".patient-item")];
  const patientCount = document.getElementById("patientCount");
  const patientEmpty = document.getElementById("patientEmpty");

  function filterPatients() {
    if (!patientItems.length) return;
    const q = (patientSearch?.value || "").trim().toLowerCase();
    let visible = 0;
    patientItems.forEach((item) => {
      const hay = (item.dataset.search || "").toLowerCase();
      const show = !q || hay.includes(q);
      item.classList.toggle("d-none", !show);
      if (show) visible++;
    });
    if (patientCount) patientCount.textContent = `${visible} مريض`;
    patientEmpty?.classList.toggle("d-none", visible !== 0);
  }
  patientSearch?.addEventListener("input", filterPatients);

  // Jobs filtering
  const jobSearch = document.getElementById("jobSearch");
  const jobStatus = document.getElementById("jobStatus");
  const jobItems = [...document.querySelectorAll(".job-item")];

  function filterJobs() {
    if (!jobItems.length) return;
    const q = (jobSearch?.value || "").trim().toLowerCase();
    const status = jobStatus?.value || "all";
    jobItems.forEach((item) => {
      const hay = (item.dataset.search || "").toLowerCase();
      const show =
        (!q || hay.includes(q)) &&
        (status === "all" || item.dataset.status === status);
      item.classList.toggle("d-none", !show);
    });
  }
  jobSearch?.addEventListener("input", filterJobs);
  jobStatus?.addEventListener("change", filterJobs);
});

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-day-row]").forEach((row) => {
    const toggle = row.querySelector(".day-available");
    const times = row.querySelectorAll(".day-time");
    const label = row.querySelector(".form-check-label");

    function syncDayAvailability() {
      const enabled = !!toggle?.checked;
      times.forEach((input) => (input.disabled = !enabled));
      if (label) label.textContent = enabled ? "متاح" : "غير متاح";
    }

    toggle?.addEventListener("change", syncDayAvailability);
    syncDayAvailability();
  });
});

document.addEventListener("DOMContentLoaded", () => {
  // Doctor weekly schedule availability
  document.querySelectorAll("[data-doctor-day]").forEach((row) => {
    const toggle = row.querySelector(".doctor-day-toggle");
    const inputs = row.querySelectorAll(".doctor-day-input");

    function sync() {
      const enabled = !!toggle?.checked;
      inputs.forEach((input) => (input.disabled = !enabled));
    }
    toggle?.addEventListener("change", sync);
    sync();
  });

  // Invoice search/filter
  const invoiceSearch = document.getElementById("invoiceSearch");
  const invoiceStatus = document.getElementById("invoiceStatusFilter");
  const invoiceItems = [...document.querySelectorAll(".invoice-filter-item")];
  const invoiceCount = document.getElementById("invoiceResultCount");
  const invoiceEmpty = document.getElementById("invoiceEmptyState");

  function filterInvoices() {
    if (!invoiceItems.length) return;
    const q = (invoiceSearch?.value || "").trim().toLowerCase();
    const status = invoiceStatus?.value || "all";
    let visible = 0;

    invoiceItems.forEach((item) => {
      const hay = (item.dataset.search || "").toLowerCase();
      const show =
        (!q || hay.includes(q)) &&
        (status === "all" || item.dataset.status === status);
      item.classList.toggle("d-none", !show);
      if (show) visible++;
    });

    if (invoiceCount)
      invoiceCount.textContent = `${visible} ${visible === 1 ? "فاتورة" : "فواتير"}`;
    invoiceEmpty?.classList.toggle("d-none", visible !== 0);
  }

  invoiceSearch?.addEventListener("input", filterInvoices);
  invoiceStatus?.addEventListener("change", filterInvoices);

  // Clinic appointment slot selection
  document
    .querySelectorAll(".slot-grid .time-slot.available")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".slot-grid .time-slot.available")
          .forEach((x) => x.classList.remove("selected"));
        btn.classList.add("selected");
      });
    });

  // Prefill appointment page from query params (e.g. follow-up from visit checkout)
  const bookingType = document.getElementById("clinicBookingType");
  const patientSelect = document.getElementById("clinicBookingPatient");

  if (bookingType || patientSelect) {
    const params = new URLSearchParams(window.location.search);
    const patient = params.get("patient");
    const type = params.get("type");

    if (
      patientSelect &&
      patient &&
      [...patientSelect.options].some((o) => o.value === patient)
    ) {
      patientSelect.value = patient;
    }
    if (
      bookingType &&
      type &&
      [...bookingType.options].some((o) => o.value === type)
    ) {
      bookingType.value = type;
    }
  }
});

// ===== Clinic v9 interactions =====
document.addEventListener("DOMContentLoaded", () => {
  const recallBtns = [...document.querySelectorAll(".recall-filter-btn")];
  const recallCards = [...document.querySelectorAll(".recall-card-v9")];
  const recallSearch = document.getElementById("recallSearchV9");
  const recallEmpty = document.getElementById("recallEmptyV9");
  let recallStatus = "all";
  function runRecallV9() {
    if (!recallCards.length) return;
    const q = (recallSearch?.value || "").trim().toLowerCase();
    let count = 0;
    recallCards.forEach((card) => {
      const show =
        (recallStatus === "all" || card.dataset.status === recallStatus) &&
        (!q || (card.dataset.search || "").toLowerCase().includes(q));
      card.classList.toggle("d-none", !show);
      if (show) count++;
    });
    recallEmpty?.classList.toggle("d-none", count !== 0);
  }
  recallBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      recallStatus = btn.dataset.recallStatus || "all";
      recallBtns.forEach((x) => {
        x.classList.remove("btn-primary", "active");
        x.classList.add("btn-light");
      });
      btn.classList.remove("btn-light");
      btn.classList.add("btn-primary", "active");
      runRecallV9();
    }),
  );
  recallSearch?.addEventListener("input", runRecallV9);

  function labBadgeClass(status) {
    if (status === "تم الاستلام") return "badge text-bg-success";
    if (status === "تم التركيب للمريض") return "badge text-bg-primary";
    return "badge text-bg-info";
  }
  document.querySelectorAll("[data-lab-status-select]").forEach((select) => {
    const badge = select.parentElement?.querySelector(
      "[data-lab-status-badge]",
    );
    const sync = () => {
      if (!badge) return;
      badge.textContent = select.value;
      badge.className = labBadgeClass(select.value);
      badge.setAttribute("data-lab-status-badge", "");
    };
    select.addEventListener("change", sync);
    sync();
  });

  function showToast(msg) {
    const el = document.getElementById("appToast");
    if (!el) return;
    const b = el.querySelector(".toast-body");
    if (b) b.textContent = msg;
    bootstrap.Toast.getOrCreateInstance(el).show();
  }

  const applicantSearch = document.getElementById("applicantSearch"),
    applicantFilter = document.getElementById("applicantStatusFilter"),
    applicantRows = [...document.querySelectorAll(".applicant-row")];
  function filterApplicants() {
    const q = (applicantSearch?.value || "").trim().toLowerCase(),
      s = applicantFilter?.value || "all";
    applicantRows.forEach((r) =>
      r.classList.toggle(
        "d-none",
        !(
          (!q || (r.dataset.search || "").toLowerCase().includes(q)) &&
          (s === "all" || r.dataset.status === s)
        ),
      ),
    );
  }
  applicantSearch?.addEventListener("input", filterApplicants);
  applicantFilter?.addEventListener("change", filterApplicants);
  document.querySelectorAll("[data-applicant-save]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const row = btn.closest(".applicant-row"),
        sel = row?.querySelector(".applicant-status-select");
      if (row && sel) row.dataset.status = sel.value;
      showToast("تم تحديث حالة طلب التوظيف تجريبياً");
      filterApplicants();
    }),
  );

  const appSelect = document.getElementById("applicationStatusSelect"),
    appSave = document.getElementById("applicationStatusSave"),
    appBadge = document.getElementById("applicationStatusBadge");
  appSave?.addEventListener("click", () => {
    const v = appSelect?.value || "review",
      map = {
        review: ["قيد المراجعة", "badge text-bg-warning mb-2"],
        accepted: ["مقبول", "badge text-bg-success mb-2"],
        rejected: ["مرفوض", "badge text-bg-danger mb-2"],
      };
    if (appBadge) {
      appBadge.textContent = map[v][0];
      appBadge.className = map[v][1];
    }
    showToast("تم تحديث حالة الطلب تجريبياً");
  });
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

// =========================================================
// Admin UI behaviors consolidated from former modules.
// Mock/business data remains in HTML only.
// =========================================================

// ---- admin-common.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const toastEl = document.getElementById("appToast");
  window.AdminUI = {
    norm: (v) => (v || "").toString().trim().toLowerCase(),
    money: (n) => `${Number(n || 0).toLocaleString("en-US")} ₪`,
    toast(msg, kind = "primary") {
      if (!toastEl) return;
      toastEl.className = `toast align-items-center text-bg-${kind} border-0`;
      const b = toastEl.querySelector(".toast-body");
      if (b) b.textContent = msg;
      bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 2400 }).show();
    },
    view(title, subtitle, body) {
      const t = document.getElementById("viewTitle"),
        s = document.getElementById("viewSubtitle"),
        b = document.getElementById("viewBody");
      if (!t || !s || !b) return;
      t.textContent = title || "التفاصيل";
      s.textContent = subtitle || "";
      b.innerHTML = body || "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("viewModal"),
      ).show();
    },
    csv(filename, rows) {
      const csv = rows
        .map((r) =>
          r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","),
        )
        .join("\n");
      const blob = new Blob(["\ufeff" + csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  };
  let pending = null;

  function labels(btn) {
    let suspend = btn.dataset.suspendLabel || "",
      reactivate = btn.dataset.reactivateLabel || "";
    const current = btn.textContent.trim();
    if (!suspend) {
      if (current.includes("تعليق")) suspend = "تعليق";
      else if (current.includes("إيقاف")) suspend = "إيقاف";
      else if (current.includes("تعطيل")) suspend = "تعطيل";
      else suspend = "تعليق";
    }
    if (!reactivate) {
      reactivate =
        suspend === "تعليق"
          ? "إلغاء التعليق"
          : suspend === "تعطيل"
            ? "تفعيل"
            : "إعادة تفعيل";
    }
    btn.dataset.suspendLabel = suspend;
    btn.dataset.reactivateLabel = reactivate;
    return { suspend, reactivate };
  }
  function setStateButton(btn, action) {
    const l = labels(btn);
    if (action === "suspend") {
      btn.dataset.sensitiveAction = "reactivate";
      btn.dataset.sensitiveTitle = btn.dataset.reactivateTitle || l.reactivate;
      btn.textContent = l.reactivate;
      btn.classList.remove("btn-outline-warning");
      btn.classList.add("btn-outline-success");
    } else if (action === "reactivate") {
      btn.dataset.sensitiveAction = "suspend";
      btn.dataset.sensitiveTitle = btn.dataset.suspendTitle || l.suspend;
      btn.textContent = l.suspend;
      btn.classList.remove("btn-outline-success");
      btn.classList.add("btn-outline-warning");
    }
  }
  function updateState(btn, action) {
    const row = btn.closest(
      "tr,[data-user-row],[data-doctor-row],[data-clinic-row],[data-staff-row]",
    );
    const badge = row?.querySelector(
      "[data-status-badge],[data-user-badge],[data-doctor-badge],[data-clinic-badge],[data-staff-badge]",
    );
    const target = btn.dataset.sensitiveTarget
      ? document.querySelector(btn.dataset.sensitiveTarget)
      : null;
    if (action === "suspend") {
      const txt = btn.dataset.inactiveStatusText || "معلق / موقوف";
      [badge, target].filter(Boolean).forEach((x) => {
        x.textContent = txt;
        x.className = "badge text-bg-secondary";
      });
      if (row) row.dataset.status = "suspended";
      setStateButton(btn, "suspend");
    } else if (action === "reactivate") {
      const txt = btn.dataset.activeStatusText || "فعال";
      [badge, target].filter(Boolean).forEach((x) => {
        x.textContent = txt;
        x.className = "badge text-bg-success";
      });
      if (row) row.dataset.status = "active";
      setStateButton(btn, "reactivate");
    } else if (action === "void") {
      [badge, target].filter(Boolean).forEach((x) => {
        x.textContent = "Void";
        x.className = "badge text-bg-secondary";
      });
      if (row) row.dataset.status = "void";
      btn.disabled = true;
      btn.textContent = "Void";
    } else if (action === "archive_record") {
      const text = btn.closest('tr')?.querySelector('[data-status],.badge');
      if (text) { text.textContent = 'مؤرشف'; text.className = 'badge text-bg-secondary'; }
      const rowEl = btn.closest('tr,[data-removable-card],.job-item');
      if (rowEl) rowEl.dataset.status = 'archived';
      btn.disabled = true; btn.textContent = 'مؤرشف';
    } else if (action === "cancel_appointment") {
      [badge, target].filter(Boolean).forEach((x) => {
        x.textContent = "ملغى";
        x.className = "badge text-bg-danger";
      });
      if (row) row.dataset.status = "cancelled";
      btn.disabled = true;
      btn.textContent = "ملغى";
    } else if (action === "invalidate") {
      [badge, target].filter(Boolean).forEach((x) => {
        x.textContent = "مبطل";
        x.className = "badge text-bg-warning";
      });
      btn.disabled = true;
      btn.textContent = "مبطل";
    }
  }
  function permanentDelete(btn) {
    const removable = btn.closest("tr,.job-item,[data-removable-card]");
    if (removable) {
      removable.remove();
      return;
    }
    const redirect = btn.dataset.sensitiveRedirect;
    if (redirect) {
      const main = document.querySelector("main.page-shell");
      if (main)
        main.innerHTML = `<section class="container py-5"><div class="soft-card p-5 text-center"><i class="bi bi-trash3 fs-1 text-danger"></i><h2 class="fw-bold mt-3">تم الحذف النهائي من العرض التجريبي</h2><p class="text-secondary">هذا عرض تجريبي فقط. الـBackend مسؤول عن تقييم الارتباطات وحماية السجلات الطبية والمالية قبل تنفيذ أي حذف حقيقي.</p><a class="btn btn-primary" href="${redirect}">العودة للقائمة</a></div></section>`;
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sensitive-action]");
    if (!btn) return;
    pending = btn;
    const action = btn.dataset.sensitiveAction,
      confirm = document.getElementById("confirmSensitiveAction"),
      title = document.getElementById("sensitiveActionTitle"),
      sub = document.getElementById("sensitiveActionSubtitle"),
      reason = document.getElementById("sensitiveActionReason"),
      alert = document.querySelector("#sensitiveActionModal .alert");
    if (confirm) {
      confirm.className =
        action === "delete" ? "btn btn-danger" : "btn btn-primary";
      confirm.textContent = action === "delete" ? "حذف نهائي" : action === "archive_record" ? "تأكيد الأرشفة" : "تأكيد";
    }
    if (title)
      title.textContent = btn.dataset.sensitiveTitle || btn.textContent.trim();
    if (sub) sub.textContent = btn.dataset.sensitiveEntity || "";
    if (reason) reason.value = "";
    if (alert) {
      alert.className = `alert ${action === "delete" ? "alert-danger" : "alert-warning"} rounded-4`;
      alert.innerHTML = action === "delete"
        ? '<i class="bi bi-exclamation-triangle-fill ms-1"></i><strong>تحذير: حذف نهائي.</strong> لا يمكن التراجع عن حذف السجل بعد تنفيذه. قد تكون له مواعيد أو ملفات طبية أو فواتير أو ارتباطات أخرى؛ لذلك يجب أن يتحقق الـBackend من جميع العلاقات قبل السماح بالحذف. هذه النسخة تعرض المحاكاة فقط ولا تحذف بيانات من قاعدة البيانات.'
        : '<i class="bi bi-shield-exclamation ms-1"></i>هذا إجراء حساس؛ اكتب السبب لتوثيقه في سجل التدقيق عند ربط الـBackend.';
    }
    // Every permanent deletion requires an explicit second acknowledgement.
    const modalBody = document.querySelector("#sensitiveActionModal .modal-body");
    let acknowledgement = document.getElementById("sensitiveDeleteAcknowledgement");
    if (modalBody && !acknowledgement) {
      acknowledgement = document.createElement("div");
      acknowledgement.id = "sensitiveDeleteAcknowledgement";
      acknowledgement.className = "form-check mt-3 p-3 border border-danger-subtle rounded-3";
      acknowledgement.innerHTML = '<input class="form-check-input" type="checkbox" id="sensitiveDeleteAckCheck"><label class="form-check-label" for="sensitiveDeleteAckCheck">قرأت التحذير وأفهم أن الحذف النهائي لا يمكن التراجع عنه وقد يؤثر في بيانات مرتبطة.</label>';
      modalBody.appendChild(acknowledgement);
    }
    if (acknowledgement) {
      acknowledgement.hidden = action !== "delete";
      const check = acknowledgement.querySelector("input");
      if (check) check.checked = false;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("sensitiveActionModal"),
    ).show();
  });
  document
    .getElementById("confirmSensitiveAction")
    ?.addEventListener("click", () => {
      const reason = document
        .getElementById("sensitiveActionReason")
        ?.value.trim();
      if (!reason) {
        AdminUI.toast("سبب الإجراء إلزامي.", "danger");
        return;
      }
      if (!pending) return;
      const action = pending.dataset.sensitiveAction;
      if (action === "delete" && !document.getElementById("sensitiveDeleteAckCheck")?.checked) {
        AdminUI.toast("يرجى قراءة التحذير وتأكيد فهمك قبل الحذف النهائي.", "danger");
        return;
      }
      if (action === "delete") permanentDelete(pending);
      else updateState(pending, action);
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("sensitiveActionModal"),
      ).hide();
      AdminUI.toast(
        action === "delete"
          ? "تم الحذف النهائي من العرض التجريبي."
          : action === "archive_record" ? "تمت محاكاة الأرشفة دون حذف التاريخ." : "تم تنفيذ الإجراء وتحديث حالة الزر مباشرة.",
        "success",
      );
      pending = null;
    });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-temp-action]");
    if (btn) AdminUI.toast(btn.dataset.tempAction || "تمت العملية مؤقتًا.");
  });
});

// ---- admin-clinics.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;
  const s = document.getElementById("approvalSearch"),
    f = document.getElementById("approvalFilter"),
    e = document.getElementById("approvalEmpty");
  function filterApprovals() {
    if (!e) return;
    let n = 0;
    const q = U.norm(s?.value),
      st = f?.value || "";
    document.querySelectorAll("[data-approval-card]").forEach((c) => {
      const ok =
        (!q ||
          U.norm((c.dataset.search || "") + " " + c.textContent).includes(q)) &&
        (!st || c.dataset.status === st);
      c.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    e.classList.toggle("d-none", !!n);
  }
  s?.addEventListener("input", filterApprovals);
  f?.addEventListener("change", filterApprovals);
  const cs = document.getElementById("clinicSearch"),
    cf = document.getElementById("clinicStatusFilter"),
    ce = document.getElementById("clinicEmpty");
  const clinicRows = () => [...document.querySelectorAll("[data-clinic-row]")];
  function filterClinics() {
    if (!ce) return;
    let n = 0;
    const q = U.norm(cs?.value),
      st = cf?.value || "";
    clinicRows().forEach((r) => {
      const ok =
        (!q ||
          U.norm((r.dataset.search || "") + " " + r.textContent).includes(q)) &&
        (!st || r.dataset.status === st);
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    ce.classList.toggle("d-none", !!n);
  }
  cs?.addEventListener("input", filterClinics);
  cf?.addEventListener("change", filterClinics);
  let editing = null;
  const form = {
    name: document.getElementById("clinicFormName"),
    city: document.getElementById("clinicFormCity"),
    status: document.getElementById("clinicFormStatus"),
    address: document.getElementById("clinicFormAddress"),
    phone: document.getElementById("clinicFormPhone"),
    email: document.getElementById("clinicFormEmail"),
    license: document.getElementById("clinicFormLicense"),
    online: document.getElementById("clinicFormOnlineBooking"),
    manager: document.getElementById("clinicFormManager"),
    managerCode: document.getElementById("clinicFormManagerCode"),
    notes: document.getElementById("clinicFormNotes"),
    reason: document.getElementById("clinicAdminReason"),
  };
  function reset() {
    Object.values(form).forEach((el) => {
      if (!el) return;
      if (el.tagName === "SELECT") el.selectedIndex = 0;
      else el.value = "";
    });
  }
  document.querySelector("[data-clinic-new]")?.addEventListener("click", () => {
    editing = null;
    reset();
    const t = document.getElementById("clinicFormTitle");
    if (t) t.textContent = "إضافة عيادة";
  });
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-clinic-edit]");
    if (!b) return;
    editing = b.closest("[data-clinic-row]");
    if (!editing) return;
    document.getElementById("clinicFormTitle").textContent =
      "تعديل بيانات العيادة";
    form.name.value =
      editing.querySelector("[data-clinic-name]")?.textContent.trim() || "";
    form.city.value =
      editing.querySelector("[data-clinic-city]")?.textContent.trim() || "";
    form.manager.value =
      editing.querySelector("[data-clinic-manager]")?.textContent.trim() || "";
    form.status.value = editing.dataset.status || "";
    form.address.value = editing.dataset.address || "";
    form.phone.value = editing.dataset.phone || "";
    form.email.value = editing.dataset.email || "";
    form.license.value = editing.dataset.license || "";
    form.online.value = editing.dataset.online || "";
    form.managerCode.value = editing.dataset.managerCode || "";
    form.notes.value = editing.dataset.notes || "";
    form.reason.value = "";
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("clinicFormModal"),
    ).show();
  });
  document.getElementById("saveClinicBtn")?.addEventListener("click", () => {
    for (const [key, label] of [
      ["name", "اسم العيادة"],
      ["city", "المدينة"],
      ["address", "العنوان"],
      ["phone", "الهاتف"],
      ["email", "البريد الرسمي"],
      ["license", "ترخيص المنشأة"],
      ["manager", "مدير العيادة"],
    ]) {
      if (!form[key]?.value.trim()) {
        U.toast(`${label} مطلوب.`, "danger");
        return;
      }
    }
    if (!form.reason?.value.trim()) {
      U.toast("سبب الإنشاء/التعديل الإداري مطلوب.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("clinicFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من نموذج العيادة فقط. بيانات العيادات تبقى في HTML والحفظ الحقيقي سيكون عبر NestJS.",
      "success",
    );
  });
});

// ---- admin-details.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;

  // Related-entity edit controls. Values come from HTML data-* attributes only.
  if (!document.getElementById("relatedEntityEditModal")) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div class="modal fade" id="relatedEntityEditModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content border-0 rounded-4"><div class="modal-header"><div><h5 class="modal-title fw-bold" id="relatedEntityEditTitle">تعديل عنصر</h5><small class="text-secondary" id="relatedEntityEditCode"></small></div><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><label class="form-label">القيمة / الاسم</label><input class="form-control" id="relatedEntityEditValue"><label class="form-label mt-3">سبب التعديل الإداري *</label><textarea class="form-control" id="relatedEntityEditReason" rows="3"></textarea></div><div class="modal-footer"><button class="btn btn-light" data-bs-dismiss="modal">إلغاء</button><button class="btn btn-primary" id="saveRelatedEntityEdit">حفظ</button></div></div></div></div>';
    document.body.appendChild(wrapper.firstElementChild);
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-admin-edit-related]");
    if (!b) return;
    document.getElementById("relatedEntityEditTitle").textContent =
      `تعديل ${b.dataset.adminEditRelated || "عنصر"}`;
    document.getElementById("relatedEntityEditCode").textContent =
      b.dataset.adminEditName || "";
    document.getElementById("relatedEntityEditValue").value =
      b.dataset.adminEditName || "";
    document.getElementById("relatedEntityEditReason").value = "";
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("relatedEntityEditModal"),
    ).show();
  });

  document
    .getElementById("saveRelatedEntityEdit")
    ?.addEventListener("click", () => {
      const reason = document
        .getElementById("relatedEntityEditReason")
        ?.value.trim();
      if (!reason) {
        U?.toast("سبب التعديل الإداري إلزامي.", "danger");
        return;
      }
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("relatedEntityEditModal"),
      ).hide();
      U?.toast(
        "تم التحقق من التعديل في الواجهة فقط. NestJS API سيتولى الحفظ لاحقًا.",
        "success",
      );
    });

  document.querySelectorAll("[data-change-request]").forEach((b) =>
    b.addEventListener("click", () => {
      const st = b.dataset.changeRequest,
        badge = document.getElementById("changeRequestBadge");
      if (badge) {
        badge.textContent =
          st === "approved" ? "تم قبول الطلب" : "تم رفض الطلب";
        badge.className = `badge ${st === "approved" ? "text-bg-success" : "text-bg-danger"}`;
      }
      U?.toast(
        st === "approved"
          ? "تم قبول الطلب بصريًا؛ الحفظ الحقيقي سيكون في الباك إند."
          : "تم رفض الطلب بصريًا؛ الموعد الأصلي يبقى كما هو.",
        st === "approved" ? "success" : "danger",
      );
    }),
  );

  document
    .getElementById("saveClinicAdminEdit")
    ?.addEventListener("click", () => {
      const ids = [
        "clinicDetailEditName",
        "clinicDetailEditCity",
        "clinicDetailEditAddress",
        "clinicDetailEditPhone",
        "clinicDetailEditEmail",
        "clinicDetailEditLicense",
        "clinicDetailEditManager",
      ];
      if (ids.some((id) => !document.getElementById(id)?.value.trim())) {
        U?.toast("أكمل جميع الحقول المطلوبة.", "danger");
        return;
      }
      if (!document.getElementById("clinicDetailAdminReason")?.value.trim()) {
        U?.toast("سبب التعديل الإداري مطلوب.", "danger");
        return;
      }
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("clinicAdminEditModal"),
      ).hide();
      U?.toast(
        "تم التحقق من النموذج فقط. بيانات HTML لم تُستبدل وسيتولى NestJS التحقق والحفظ لاحقًا.",
        "success",
      );
    });

  const requiredReasonHandlers = [
    ["saveMedicalAdminEdit", "medicalAdminReason", "medicalAdminEditModal"],
    [
      "saveAppointmentAdminEdit",
      "appointmentAdminReason",
      "appointmentEditModal",
    ],
    ["saveInvoiceAdminEdit", "invoiceAdminReason", "invoiceAdminEditModal"],
    ["saveDoctorAdminEdit", "doctorDetailAdminReason", "doctorAdminEditModal"],
  ];
  requiredReasonHandlers.forEach(([btnId, reasonId, modalId]) =>
    document.getElementById(btnId)?.addEventListener("click", () => {
      if (!document.getElementById(reasonId)?.value.trim()) {
        U?.toast("سبب التعديل الإداري إلزامي.", "danger");
        return;
      }
      const modal = document.getElementById(modalId);
      if (modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
      U?.toast(
        "تم التحقق من النموذج فقط. الحفظ الحقيقي سيكون عبر NestJS.",
        "success",
      );
    }),
  );

  document.querySelectorAll("[data-view-before-after]").forEach((b) =>
    b.addEventListener("click", () => {
      const m = document.getElementById("beforeAfterModal");
      if (m) bootstrap.Modal.getOrCreateInstance(m).show();
    }),
  );
});

// ---- admin-doctors.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;
  const search = document.getElementById("doctorSearch"),
    lic = document.getElementById("doctorLicenseFilter"),
    status = document.getElementById("doctorStatusFilter"),
    empty = document.getElementById("doctorEmpty");
  const rows = () => [...document.querySelectorAll("[data-doctor-row]")];
  function filter() {
    if (!empty) return;
    const q = U.norm(search?.value),
      l = lic?.value || "",
      st = status?.value || "";
    let n = 0;
    rows().forEach((r) => {
      const ok =
        (!q ||
          U.norm((r.dataset.search || "") + " " + r.textContent).includes(q)) &&
        (!l || r.dataset.license === l) &&
        (!st || r.dataset.status === st);
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    empty.classList.toggle("d-none", !!n);
  }
  search?.addEventListener("input", filter);
  lic?.addEventListener("change", filter);
  status?.addEventListener("change", filter);
  const ps = new URLSearchParams(location.search);
  if (lic && ps.get("filter")) {
    lic.value = ps.get("filter");
    filter();
  }
  let doctorRow = null,
    jobRow = null;
  document.querySelector("[data-doctor-new]")?.addEventListener("click", () => {
    doctorRow = null;
    const t = document.getElementById("doctorFormTitle");
    if (t) t.textContent = "إنشاء طبيب إداري استثنائي";
    document
      .querySelectorAll("#doctorFormModal input,#doctorFormModal textarea")
      .forEach((x) => {
        if (x.type !== "hidden") x.value = "";
      });
  });
  document.querySelector("[data-job-new]")?.addEventListener("click", () => {
    jobRow = null;
    const t = document.getElementById("jobFormTitle");
    if (t) t.textContent = "إنشاء وظيفة إداريًا (Override)";
    document
      .querySelectorAll("#jobFormModal input,#jobFormModal textarea")
      .forEach((x) => {
        if (x.type !== "hidden") x.value = "";
      });
  });
  document.addEventListener("click", (e) => {
    const rv = e.target.closest("[data-license-review]");
    if (rv) {
      location.href = `doctor-license-review.html?id=${encodeURIComponent(rv.dataset.licenseReview)}`;
      return;
    }
    const b = e.target.closest("[data-doctor-edit]");
    if (b) {
      doctorRow = b.closest("[data-doctor-row]");
      if (!doctorRow) return;
      document.getElementById("doctorFormTitle").textContent = "تعديل الطبيب";
      document.getElementById("doctorFormName").value =
        doctorRow.querySelector("[data-doctor-name]")?.textContent.trim() || "";
      document.getElementById("doctorFormSpecialty").value =
        doctorRow
          .querySelector("[data-doctor-specialty]")
          ?.textContent.trim() || "";
      document.getElementById("doctorFormClinic").value =
        doctorRow.querySelector("[data-doctor-clinic]")?.textContent.trim() ||
        "";
      document.getElementById("doctorFormLicense").value =
        doctorRow.querySelector("[data-doctor-license]")?.textContent.trim() ||
        "";
      document.getElementById("doctorAdminReason").value = "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("doctorFormModal"),
      ).show();
    }
    const je = e.target.closest("[data-job-edit]");
    if (je) {
      jobRow = je.closest("[data-job-row]");
      if (!jobRow) return;
      document.getElementById("jobFormTitle").textContent = "تعديل الوظيفة";
      document.getElementById("jobFormTitleInput").value =
        jobRow.querySelector("[data-job-title]")?.textContent.trim() || "";
      document.getElementById("jobFormClinic").value =
        jobRow.querySelector("[data-job-clinic]")?.textContent.trim() || "";
      document.getElementById("jobFormCity").value =
        jobRow.querySelector("[data-job-city]")?.textContent.trim() || "";
      document.getElementById("jobAdminReason").value = "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("jobFormModal"),
      ).show();
    }
    const jt = e.target.closest("[data-job-toggle]");
    if (jt) {
      const r = jt.closest("[data-job-row]"),
        badge = r?.querySelector("[data-job-badge]");
      if (!r || !badge) return;
      const on = r.dataset.status !== "active";
      r.dataset.status = on ? "active" : "suspended";
      badge.textContent = on ? "منشور" : "معلقة";
      badge.className = `badge ${on ? "text-bg-success" : "text-bg-secondary"}`;
      jt.textContent = on ? "تعليق" : "إعادة نشر";
      jt.className = `btn btn-sm ${on ? "btn-outline-warning" : "btn-outline-success"}`;
      U.toast(
        "تم تغيير الحالة بصريًا فقط؛ بيانات HTML الأصلية لم تُحفظ أو تُستبدل.",
        "success",
      );
    }
  });
  document.getElementById("saveDoctorBtn")?.addEventListener("click", () => {
    const name = document.getElementById("doctorFormName")?.value.trim(),
      spec = document.getElementById("doctorFormSpecialty")?.value.trim(),
      license = document.getElementById("doctorFormLicense")?.value.trim(),
      reason = document.getElementById("doctorAdminReason")?.value.trim();
    if (!name || !spec || !license) {
      U.toast("الاسم والتخصص ورقم الترخيص مطلوبة.", "danger");
      return;
    }
    if (!reason) {
      U.toast("سبب الإنشاء/التعديل الإداري مطلوب.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("doctorFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من النموذج فقط. لن ينشئ JavaScript أو يعدّل سجل طبيب؛ NestJS API سيتولى الحفظ لاحقًا.",
      "success",
    );
  });
  document.getElementById("saveJobBtn")?.addEventListener("click", () => {
    const title = document.getElementById("jobFormTitleInput")?.value.trim(),
      clinic = document.getElementById("jobFormClinic")?.value.trim(),
      deadline = document.getElementById("jobFormDeadline")?.value || "",
      desc = document.getElementById("jobFormDescription")?.value.trim() || "",
      reason = document.getElementById("jobAdminReason")?.value.trim();
    if (!title || !clinic || !deadline || !desc) {
      U.toast("عنوان الوظيفة والعيادة وآخر موعد والوصف مطلوبة.", "danger");
      return;
    }
    if (!reason) {
      U.toast("سبب التدخل الإداري مطلوب.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("jobFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من نموذج الوظيفة فقط. بيانات الوظائف المعروضة تبقى داخل HTML والحفظ سيكون عبر NestJS.",
      "success",
    );
  });
});

// ---- admin-finance.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI,
    rows = () => [...document.querySelectorAll("[data-finance-row]")];
  function statusOf(r) {
    const d = Number(r.dataset.due),
      x = Number(r.dataset.received);
    return x <= 0 ? "unpaid" : x >= d ? "paid" : "remaining";
  }
  function renderComputed(r) {
    const d = Number(r.dataset.due),
      x = Number(r.dataset.received),
      rem = Math.max(0, d - x);
    r.querySelector("[data-due-cell]") &&
      (r.querySelector("[data-due-cell]").textContent = U.money(d));
    r.querySelector("[data-received-cell]") &&
      (r.querySelector("[data-received-cell]").textContent = U.money(x));
    r.querySelector("[data-remaining-cell]") &&
      (r.querySelector("[data-remaining-cell]").textContent = U.money(rem));
  }
  rows().forEach(renderComputed);
  const search = document.getElementById("financeSearch"),
    filterStatus = document.getElementById("financeStatus"),
    period = document.getElementById("financePeriod"),
    empty = document.getElementById("financeEmpty"),
    customDates = document.getElementById("financeCustomDates"),
    fromDate = document.getElementById("financeFromDate"),
    toDate = document.getElementById("financeToDate");
  function rowInCustomRange(r) {
    if (period?.value !== "custom" || !fromDate?.value || !toDate?.value)
      return true;
    const [y, m] = (r.dataset.period || "").split("-").map(Number);
    if (!y || !m) return false;
    const start = `${y}-${String(m).padStart(2, "0")}-01`,
      last = new Date(y, m, 0).getDate(),
      end = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return end >= fromDate.value && start <= toDate.value;
  }
  function syncCustomDates() {
    customDates?.classList.toggle("d-none", period?.value !== "custom");
  }
  function filter() {
    if (!empty) return;
    let n = 0;
    const q = U.norm(search?.value),
      st = filterStatus?.value || "",
      p = period?.value || "";
    rows().forEach((r) => {
      const periodOk =
          !p || (p === "custom" ? rowInCustomRange(r) : r.dataset.period === p),
        ok =
          (!q || U.norm(r.dataset.search || "").includes(q)) &&
          (!st || statusOf(r) === st) &&
          periodOk;
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    empty.classList.toggle("d-none", !!n);
  }
  search?.addEventListener("input", filter);
  filterStatus?.addEventListener("change", filter);
  period?.addEventListener("change", () => {
    syncCustomDates();
    filter();
  });
  document
    .getElementById("applyFinanceCustomDates")
    ?.addEventListener("click", () => {
      if (!fromDate?.value || !toDate?.value) {
        U.toast("حدد تاريخ البداية والنهاية.", "danger");
        return;
      }
      if (fromDate.value > toDate.value) {
        U.toast("تاريخ البداية يجب أن يكون قبل تاريخ النهاية.", "danger");
        return;
      }
      filter();
      U.toast("تم تطبيق الفترة على بيانات HTML المعروضة.", "success");
    });
  syncCustomDates();
  document
    .getElementById("exportFinanceBtn")
    ?.addEventListener("click", () =>
      U.csv("finance-demo.csv", [
        ["settlement", "clinic", "period", "due", "received", "remaining"],
        ...rows().map((r) => [
          r.dataset.settlementCode || "",
          r.querySelector("td strong")?.textContent.trim(),
          r.dataset.period,
          r.dataset.due,
          r.dataset.received,
          Math.max(0, Number(r.dataset.due) - Number(r.dataset.received)),
        ]),
      ]),
    );
  document.querySelectorAll("[data-finance-details]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = b.closest("[data-finance-row]");
      if (!r) return;
      const due = Number(r.dataset.due),
        rec = Number(r.dataset.received),
        rem = Math.max(0, due - rec);
      document.getElementById("financeDetailClinic").textContent =
        r.querySelector("td strong")?.textContent.trim() || "";
      document.getElementById("financeDetailPeriod").textContent =
        r.children[1]?.textContent.trim() || "";
      document.getElementById("financeDetailDue").textContent = U.money(due);
      document.getElementById("financeDetailReceived").textContent =
        U.money(rec);
      document.getElementById("financeDetailRemaining").textContent =
        U.money(rem);
      const code = document.getElementById("financeDetailSettlementCode");
      if (code) code.textContent = r.dataset.settlementCode || "—";
      const body = document.getElementById("financePaymentsBody");
      if (body) {
        const payments = (b.dataset.payments || "")
          .split(";")
          .map((x) => x.trim())
          .filter(Boolean);
        body.innerHTML = payments.length
          ? payments
              .map((entry) => {
                const [date, amount, method, reference] = entry.split("|");
                return `<tr><td>${date || "—"}</td><td>${amount || "—"}</td><td>${method || "—"}</td><td>${reference || "—"}</td></tr>`;
              })
              .join("")
          : '<tr><td colspan="4" class="text-center text-secondary py-3">لا توجد دفعات مسجلة لهذه التسوية.</td></tr>';
      }
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("financeDetailsModal"),
      ).show();
    }),
  );
  let current = null;
  document.querySelectorAll("[data-record-payment]").forEach((b) =>
    b.addEventListener("click", () => {
      current = b.closest("[data-finance-row]");
      if (!current) return;
      const rem = Math.max(
        0,
        Number(current.dataset.due) - Number(current.dataset.received),
      );
      document.getElementById("paymentClinicName").textContent =
        current.querySelector("td strong")?.textContent.trim() || "";
      document.getElementById("paymentCurrentRemaining").textContent =
        U.money(rem);
      document.getElementById("paymentAmount").value = "";
      document.getElementById("paymentAmount").max = rem;
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("recordPaymentModal"),
      ).show();
    }),
  );
  document.getElementById("savePaymentBtn")?.addEventListener("click", () => {
    if (!current) return;
    const rem = Math.max(
        0,
        Number(current.dataset.due) - Number(current.dataset.received),
      ),
      amt = Number(document.getElementById("paymentAmount")?.value);
    if (!amt || amt <= 0) {
      U.toast("أدخل مبلغًا صحيحًا.", "danger");
      return;
    }
    if (amt > rem) {
      U.toast("المبلغ أكبر من المتبقي.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("recordPaymentModal"),
    ).hide();
    U.toast(
      "تم التحقق من الدفعة فقط. لن يعدّل JavaScript بيانات التسوية؛ NestJS API سيسجلها لاحقًا.",
      "success",
    );
  });
  let editingInvoice = null;
  document
    .querySelector("[data-invoice-new]")
    ?.addEventListener("click", () => {
      editingInvoice = null;
      document
        .querySelectorAll("#invoiceFormModal input")
        .forEach((e) => (e.value = ""));
    });
  document.querySelectorAll("[data-invoice-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      editingInvoice = b.closest("[data-invoice-row]");
      if (!editingInvoice) return;
      document.getElementById("invoiceFormId").value =
        editingInvoice.querySelector("[data-invoice-id]")?.textContent.trim() ||
        "";
      document.getElementById("invoiceFormPatient").value =
        editingInvoice
          .querySelector("[data-invoice-patient]")
          ?.textContent.trim() || "";
      document.getElementById("invoiceFormClinic").value =
        editingInvoice
          .querySelector("[data-invoice-clinic]")
          ?.textContent.trim() || "";
      document.getElementById("invoiceFormTotal").value =
        editingInvoice
          .querySelector("[data-invoice-total]")
          ?.textContent.trim() || "";
      document.getElementById("invoiceFormPaid").value =
        editingInvoice
          .querySelector("[data-invoice-paid]")
          ?.textContent.trim() || "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("invoiceFormModal"),
      ).show();
    }),
  );
  document.querySelectorAll("[data-invoice-view]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = b.closest("[data-invoice-row]"),
        id = r?.querySelector("[data-invoice-id]")?.textContent.trim();
      if (id)
        location.href = `invoice-details.html?id=${encodeURIComponent(id)}`;
    }),
  );
  document.getElementById("saveInvoiceBtn")?.addEventListener("click", () => {
    const id = document.getElementById("invoiceFormId")?.value.trim(),
      pat = document.getElementById("invoiceFormPatient")?.value.trim(),
      total = Number(document.getElementById("invoiceFormTotal")?.value);
    if (!id || !pat || !total) {
      U.toast("رقم الفاتورة والمريض والإجمالي مطلوبة.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("invoiceFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من نموذج الفاتورة فقط. بيانات الفواتير في HTML والحفظ سيكون عبر NestJS.",
      "success",
    );
  });
});

// ---- admin-full-control.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI,
    modal = document.getElementById("adminRelatedEntityModal");
  if (!modal) return;
  const title = document.getElementById("adminRelatedEntityTitle"),
    intro = document.getElementById("adminEntityFormIntro"),
    fields = document.getElementById("adminEntitySpecificFields"),
    typeInput = document.getElementById("adminRelatedEntityType"),
    reason = document.getElementById("adminRelatedEntityReason"),
    save = document.getElementById("saveAdminRelatedEntity"),
    q = new URLSearchParams(location.search),
    clinicContext = document.getElementById("detailClinicName")
      ? q.get("id") ||
        document
          .getElementById("detailClinicCode")
          ?.textContent.replace("public_code:", "")
          .trim()
      : null;
  function preselectClinic() {
    if (!clinicContext) return;
    fields.querySelectorAll('[name="clinic"]').forEach((el) => {
      if (el.tagName === "SELECT") {
        const o = [...el.options].find(
          (x) =>
            x.value.includes(clinicContext) ||
            x.textContent.includes(clinicContext),
        );
        if (o) {
          el.value = o.value;
          el.disabled = true;
        }
      } else {
        el.value = clinicContext;
        el.readOnly = true;
      }
    });
  }
  function open(type) {
    const tpl = document.querySelector(
      `template[data-admin-form="${CSS.escape(type)}"]`,
    );
    if (!tpl) {
      U?.toast("هذا النموذج غير متوفر في الصفحة الحالية.", "warning");
      return;
    }
    typeInput.value = type;
    title.textContent = tpl.dataset.adminTitle || "إضافة";
    intro.innerHTML = `<strong>${tpl.dataset.adminTitle || "إضافة"}</strong><div class="small mt-1">${tpl.dataset.adminHelp || ""}</div>`;
    fields.innerHTML = "";
    fields.append(tpl.content.cloneNode(true));
    reason.value = "";
    preselectClinic();
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-admin-create]");
    if (b) open(b.dataset.adminCreate);
  });
  save?.addEventListener("click", () => {
    const missing = [...fields.querySelectorAll("[required]")].filter((e) =>
      e.type === "file" ? !e.files?.length : !String(e.value || "").trim(),
    );
    if (missing.length) {
      U?.toast("أكمل الحقول المطلوبة.", "danger");
      missing[0].focus();
      return;
    }
    if (!reason.value.trim()) {
      U?.toast("سبب الإضافة/التعديل الإداري مطلوب.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(modal).hide();
    U?.toast(
      "تم التحقق من النموذج فقط. لن ينشئ JavaScript أي سجل؛ الإضافة الحقيقية ستكون عبر NestJS.",
      "success",
    );
  });
  const action = q.get("action");
  if (action) setTimeout(() => open(action), 100);
});

// ---- admin-specialties.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI,
    s = document.getElementById("specialtySearch"),
    f = document.getElementById("specialtyStatus"),
    e = document.getElementById("specialtyEmpty");
  function run() {
    if (!e) return;
    let n = 0;
    const q = U.norm(s?.value),
      st = f?.value || "";
    document.querySelectorAll("[data-specialty-row]").forEach((r) => {
      const ok =
        (!q ||
          U.norm((r.dataset.search || "") + " " + r.textContent).includes(q)) &&
        (!st || r.dataset.status === st);
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    e.classList.toggle("d-none", !!n);
  }
  s?.addEventListener("input", run);
  f?.addEventListener("change", run);
  let edit = null;
  document
    .querySelector("[data-specialty-new]")
    ?.addEventListener("click", () => {
      edit = null;
      document.getElementById("specialtyModalTitle").textContent = "إضافة تخصص";
      document.getElementById("specialtyAr").value = "";
      document.getElementById("specialtyEn").value = "";
      const st = document.getElementById("specialtyFormStatus");
      if (st) st.selectedIndex = 0;
    });
  document.querySelectorAll("[data-specialty-edit]").forEach((b) =>
    b.addEventListener("click", () => {
      edit = b.closest("[data-specialty-row]");
      document.getElementById("specialtyModalTitle").textContent =
        "تعديل التخصص";
      document.getElementById("specialtyAr").value =
        edit.querySelector("[data-ar]")?.textContent.trim() || "";
      document.getElementById("specialtyEn").value =
        edit.querySelector("[data-en]")?.textContent.trim() || "";
      document.getElementById("specialtyFormStatus").value =
        edit.dataset.status || "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("specialtyModal"),
      ).show();
    }),
  );
  document.querySelectorAll("[data-specialty-toggle]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = b.closest("[data-specialty-row]"),
        off = r.dataset.status === "active",
        badge = r.querySelector("[data-specialty-badge]");
      r.dataset.status = off ? "disabled" : "active";
      if (badge) {
        badge.textContent = off ? "معطّل" : "مفعّل";
        badge.className = `badge ${off ? "text-bg-secondary" : "text-bg-success"}`;
      }
      b.textContent = off ? "تفعيل" : "تعطيل";
      U.toast("تم تغيير الحالة بصريًا فقط؛ بيانات HTML الأصلية لم تتغير.");
    }),
  );
  document.getElementById("saveSpecialtyBtn")?.addEventListener("click", () => {
    const ar = document.getElementById("specialtyAr")?.value.trim(),
      en = document.getElementById("specialtyEn")?.value.trim();
    if (!ar || !en) {
      U.toast("أدخل الاسمين العربي والإنجليزي.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("specialtyModal"),
    ).hide();
    U.toast(
      "تم التحقق من النموذج فقط. NestJS API سيتولى إنشاء/تعديل التخصص.",
      "success",
    );
  });
});

// ---- admin-support-reports.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;
  const ts = document.getElementById("ticketSearch"),
    tst = document.getElementById("ticketStatusFilter"),
    tt = document.getElementById("ticketTypeFilter"),
    te = document.getElementById("ticketEmpty");
  function ft() {
    if (!te) return;
    let n = 0;
    const q = U.norm(ts?.value),
      st = tst?.value || "",
      tp = tt?.value || "";
    document.querySelectorAll("[data-ticket-row]").forEach((r) => {
      const ok =
        (!q || U.norm(r.dataset.search + " " + r.textContent).includes(q)) &&
        (!st || r.dataset.status === st) &&
        (!tp || r.dataset.type === tp);
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    te.classList.toggle("d-none", !!n);
  }
  ts?.addEventListener("input", ft);
  tst?.addEventListener("change", ft);
  tt?.addEventListener("change", ft);
  document.querySelectorAll("[data-ticket-close]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = b.closest("[data-ticket-row]");
      if (r) {
        r.dataset.status = "closed";
        const badge = r.querySelector("[data-ticket-badge]");
        if (badge) {
          badge.textContent = "مغلق";
          badge.className = "badge text-bg-secondary";
        }
        b.disabled = true;
        b.textContent = "مغلق";
        U.toast("تم إغلاق التذكرة مؤقتًا.", "success");
      }
    }),
  );
  const ls = document.getElementById("logSearch"),
    lt = document.getElementById("logType"),
    ld = document.getElementById("logDate"),
    le = document.getElementById("logEmpty");
  function fl() {
    if (!le) return;
    let n = 0;
    const q = U.norm(ls?.value),
      tp = lt?.value || "",
      dt = ld?.value || "";
    document.querySelectorAll("[data-log-row]").forEach((r) => {
      const ok =
        (!q || U.norm(r.dataset.search + " " + r.textContent).includes(q)) &&
        (!tp || r.dataset.type === tp) &&
        (!dt || r.dataset.date === dt);
      r.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    le.classList.toggle("d-none", !!n);
  }
  ls?.addEventListener("input", fl);
  lt?.addEventListener("change", fl);
  ld?.addEventListener("change", fl);
  document.getElementById("resetLogFilters")?.addEventListener("click", () => {
    if (ls) ls.value = "";
    if (lt) lt.value = "";
    if (ld) ld.value = "";
    fl();
  });
  document
    .getElementById("exportLogBtn")
    ?.addEventListener("click", () =>
      U.csv("system-log-demo.csv", [
        ["time", "actor", "event", "entity", "type"],
        ...[...document.querySelectorAll("[data-log-row]")].map((r) => [
          r.children[0]?.textContent.trim(),
          r.children[1]?.textContent.trim(),
          r.querySelector("strong")?.textContent.trim(),
          r.querySelector("small")?.textContent.trim(),
          r.dataset.type,
        ]),
      ]),
    );
});
document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;
  let ticket = null;
  document.querySelector("[data-ticket-new]")?.addEventListener("click", () => {
    ticket = null;
    document.getElementById("ticketFormTitle").textContent =
      "تذكرة إدارية جديدة";
    ["ticketFormSender", "ticketFormSubject", "ticketFormNotes"].forEach(
      (id) => {
        const e = document.getElementById(id);
        if (e) e.value = "";
      },
    );
  });
  document.querySelectorAll("[data-ticket-open]").forEach((b) =>
    b.addEventListener("click", () => {
      ticket = b.closest("[data-ticket-row]");
      document.getElementById("ticketFormTitle").textContent =
        `التذكرة ${ticket.querySelector("[data-ticket-id]").textContent.trim()}`;
      document.getElementById("ticketFormType").value = ticket.dataset.type;
      document.getElementById("ticketFormStatus").value = ticket.dataset.status;
      document.getElementById("ticketFormSender").value = ticket
        .querySelector("[data-ticket-sender]")
        .textContent.trim();
      document.getElementById("ticketFormSubject").value = ticket
        .querySelector("[data-ticket-subject]")
        .textContent.trim();
      document.getElementById("ticketFormNotes").value =
        ticket.dataset.notes || "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("ticketFormModal"),
      ).show();
    }),
  );
  document.getElementById("saveTicketBtn")?.addEventListener("click", () => {
    const sender = document.getElementById("ticketFormSender")?.value.trim(),
      subject = document.getElementById("ticketFormSubject")?.value.trim();
    if (!sender || !subject) {
      U.toast("المرسل والكيان/الموضوع مطلوبان.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("ticketFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من نموذج التذكرة فقط. لن ينشئ JavaScript أو يعدّل سجلًا؛ NestJS API سيتولى الحفظ.",
      "success",
    );
  });
  document.querySelectorAll("[data-log-view]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = b.dataset.logView.split("|");
      U.view(
        p[0],
        p[1],
        `<div style="white-space:pre-line;line-height:1.8">${(p.slice(2).join("|") || "").replace(/</g, "&lt;")}</div>`,
      );
    }),
  );
  const period = document.getElementById("reportPeriod"),
    custom = document.getElementById("customReportDates");
  period?.addEventListener("change", () => {
    custom?.classList.toggle("d-none", period.value !== "custom");
    U.toast("تم تطبيق فترة التقرير على بيانات العرض.");
  });
  document.getElementById("exportReportsBtn")?.addEventListener("click", () =>
    U.csv("reports-demo.csv", [
      ["indicator", "value"],
      ["bookings", document.getElementById("reportBookings")?.textContent],
      ["patients", document.getElementById("reportPatients")?.textContent],
      ["no_show", document.getElementById("reportNoshow")?.textContent],
      ["collection", document.getElementById("reportCollection")?.textContent],
    ]),
  );
  document
    .querySelectorAll("[data-temp-save]")
    .forEach((b) =>
      b.addEventListener("click", () =>
        U.toast(b.dataset.tempSave || "تم الحفظ مؤقتًا.", "success"),
      ),
    );
  document.getElementById("savePasswordBtn")?.addEventListener("click", () => {
    const a = document.getElementById("newAdminPassword").value,
      b = document.getElementById("confirmAdminPassword").value;
    if (!a || a.length < 8) {
      U.toast("كلمة المرور يجب أن تكون 8 أحرف على الأقل.", "danger");
      return;
    }
    if (a !== b) {
      U.toast("تأكيد كلمة المرور غير مطابق.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("passwordModal"),
    ).hide();
    U.toast("تم تغيير كلمة المرور مؤقتًا.", "success");
  });
});

// Reports: values are stored as hidden HTML nodes. JavaScript only switches what is displayed.
document.addEventListener("DOMContentLoaded", () => {
  const dataRoot = document.getElementById("adminReportDataHtml");
  const period = document.getElementById("reportPeriod");
  if (!dataRoot || !period) return;
  const clinic = document.getElementById("reportClinic");

  function textFrom(block, selector, fallback = "—") {
    return block?.querySelector(selector)?.textContent.trim() || fallback;
  }

  function renderDataset() {
    const key = period.value || "month";
    const block =
      dataRoot.querySelector(`[data-report-dataset="${CSS.escape(key)}"]`) ||
      dataRoot.querySelector('[data-report-dataset="month"]') ||
      dataRoot.querySelector("[data-report-dataset]");
    if (!block) return;

    [
      "reportBookings",
      "reportPatients",
      "reportNoshow",
      "reportCollection",
    ].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = textFrom(block, `[data-kpi="${i}"]`);
    });

    document.querySelectorAll("[data-report-funnel-count]").forEach((el) => {
      const i = el.dataset.reportFunnelCount;
      el.textContent =
        block.querySelector(`[data-funnel-index="${i}"]`)?.dataset.count || "—";
    });
    document.querySelectorAll("[data-report-funnel-pct]").forEach((el) => {
      const i = el.dataset.reportFunnelPct;
      el.textContent =
        block.querySelector(`[data-funnel-index="${i}"]`)?.dataset.pct || "—";
    });
    document.querySelectorAll("[data-report-funnel-bar]").forEach((el) => {
      const i = el.dataset.reportFunnelBar;
      el.style.width =
        block.querySelector(`[data-funnel-index="${i}"]`)?.dataset.pct || "0%";
    });

    [
      "reportFinanceDue",
      "reportFinanceReceived",
      "reportFinanceRemaining",
      "reportFinancePaidClinics",
    ].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.textContent = textFrom(block, `[data-finance="${i}"]`);
    });
    const fbar = document.getElementById("reportFinanceBar");
    if (fbar) fbar.style.width = textFrom(block, '[data-finance="4"]', "0%");

    const visibleRows = [...document.querySelectorAll("#reportClinicRows tr")];
    const sourceRows = [...block.querySelectorAll("[data-clinic-row]")];
    visibleRows.forEach((row, i) => {
      const src = sourceRows[i];
      if (!src) {
        row.classList.add("d-none");
        return;
      }
      row.classList.remove("d-none");
      const vals = [...src.querySelectorAll("[data-col]")].map((x) =>
        x.textContent.trim(),
      );
      const cells = row.querySelectorAll("td");
      if (cells[0])
        cells[0].innerHTML = `<strong>${vals[0] || ""}</strong><small class="d-block">${vals[1] || ""}</small>`;
      if (cells[1]) cells[1].textContent = vals[2] || "";
      if (cells[2]) cells[2].textContent = vals[3] || "";
      if (cells[3]) cells[3].textContent = vals[4] || "";
      if (cells[4]) cells[4].textContent = vals[5] || "";
    });

    document.querySelectorAll("[data-report-specialty-pct]").forEach((el) => {
      const i = el.dataset.reportSpecialtyPct;
      el.textContent = `${textFrom(block, `[data-specialty="${i}"]`, "0")}%`;
    });
    document.querySelectorAll("[data-report-specialty-bar]").forEach((el) => {
      const i = el.dataset.reportSpecialtyBar;
      el.style.width = `${textFrom(block, `[data-specialty="${i}"]`, "0")}%`;
    });

    const badge = document.getElementById("reportScopeBadge");
    if (badge) badge.textContent = block.dataset.label || "الفترة المحددة";
    document
      .getElementById("customReportDates")
      ?.classList.toggle("d-none", key !== "custom");
  }

  period.addEventListener("change", renderDataset);
  document
    .getElementById("reportFrom")
    ?.addEventListener("change", renderDataset);
  document
    .getElementById("reportTo")
    ?.addEventListener("change", renderDataset);
  clinic?.addEventListener("change", renderDataset);
  renderDataset();
});

// ---- admin-users.js (UI behavior only) ----

document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI,
    search = document.getElementById("userSearch"),
    role = document.getElementById("userRoleFilter"),
    status = document.getElementById("userStatusFilter"),
    empty = document.getElementById("userEmpty"),
    roleSelect = document.getElementById("userFormRole");
  const rows = () => [...document.querySelectorAll("[data-user-row]")];
  function filter() {
    if (!empty) return;
    const q = U.norm(search?.value),
      r = role?.value || "",
      st = status?.value || "";
    let n = 0;
    rows().forEach((x) => {
      const ok =
        (!q ||
          U.norm((x.dataset.search || "") + " " + x.textContent).includes(q)) &&
        (!r ||
          (x.dataset.profiles || x.dataset.role || "")
            .split(",")
            .includes(r)) &&
        (!st || x.dataset.status === st);
      x.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    empty.classList.toggle("d-none", !!n);
  }
  search?.addEventListener("input", filter);
  role?.addEventListener("change", filter);
  status?.addEventListener("change", filter);
  function syncRoleFields() {
    document
      .querySelectorAll("[data-user-role-fields]")
      .forEach((x) =>
        x.classList.toggle(
          "d-none",
          x.dataset.userRoleFields !== roleSelect?.value,
        ),
      );
  }
  roleSelect?.addEventListener("change", syncRoleFields);
  syncRoleFields();
  function specificError() {
    if (
      roleSelect?.value === "patient" &&
      !document.getElementById("userSpecificBirthdate")?.value
    )
      return "تاريخ ميلاد المريض مطلوب.";
    if (roleSelect?.value === "doctor") {
      if (!document.getElementById("userSpecificLicense")?.value.trim())
        return "رقم الترخيص مطلوب.";
    }
    return "";
  }
  let editing = null;
  document.querySelector("[data-user-new]")?.addEventListener("click", () => {
    editing = null;
    document.getElementById("userFormTitle").textContent = "إضافة مستخدم";
    document
      .querySelectorAll("#userFormModal input,#userFormModal textarea")
      .forEach((e) => {
        if (e.type !== "hidden") e.value = "";
      });
    if (roleSelect) roleSelect.selectedIndex = 0;
    syncRoleFields();
  });
  document.addEventListener("click", (e) => {
    const edit = e.target.closest("[data-user-edit]");
    if (edit) {
      editing = edit.closest("[data-user-row]");
      if (!editing) return;
      document.getElementById("userFormTitle").textContent = "تعديل المستخدم";
      document.getElementById("userFormName").value =
        editing.querySelector("[data-user-name]")?.textContent.trim() || "";
      const c =
        editing.querySelector("[data-user-contact]")?.innerText.split("\n") ||
        [];
      document.getElementById("userFormEmail").value = c[0]?.trim() || "";
      document.getElementById("userFormPhone").value = c[1]?.trim() || "";
      if (roleSelect) roleSelect.value = editing.dataset.role || "patient";
      syncRoleFields();
      document.getElementById("userFormRelation").value =
        editing.children[3]?.textContent.trim() === "—"
          ? ""
          : editing.children[3]?.textContent.trim();
      document.getElementById("userAdminReason").value = "";
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("userFormModal"),
      ).show();
    }
    const view = e.target.closest("[data-user-view]");
    if (view) {
      const r = view.closest("[data-user-row]");
      if (!r) return;
      U.view(
        r.querySelector("[data-user-name]")?.textContent.trim() || "المستخدم",
        `${r.querySelector("[data-user-id]")?.textContent.trim() || ""} • ${r.children[1]?.innerText.trim() || ""}`,
        `<div class="summary-row"><span>التواصل</span><strong>${r.querySelector("[data-user-contact]")?.innerText.trim().replace(/\n/g, " • ") || ""}</strong></div><div class="summary-row"><span>الارتباط</span><strong>${r.children[3]?.innerText.trim() || "—"}</strong></div>`,
      );
    }
  });
  document.getElementById("saveUserBtn")?.addEventListener("click", () => {
    const name = document.getElementById("userFormName")?.value.trim(),
      email = document.getElementById("userFormEmail")?.value.trim(),
      reason = document.getElementById("userAdminReason")?.value.trim(),
      err = specificError();
    if (!name || !email) {
      U.toast("الاسم والبريد مطلوبان.", "danger");
      return;
    }
    if (err) {
      U.toast(err, "danger");
      return;
    }
    if (!reason) {
      U.toast("سبب الإنشاء/التعديل الإداري مطلوب.", "danger");
      return;
    }
    bootstrap.Modal.getOrCreateInstance(
      document.getElementById("userFormModal"),
    ).hide();
    U.toast(
      "تم التحقق من نموذج المستخدم فقط. لا توجد إضافة أو تعديل سجلات بواسطة JavaScript؛ NestJS API سيتولى الحفظ.",
      "success",
    );
  });
});

// Admin settings tabs: keep Bootstrap pills functional and support direct hashes such as settings.html#account.
document.addEventListener("DOMContentLoaded", () => {
  const tabList = document.querySelector("[data-settings-tabs]");
  if (!tabList || typeof bootstrap === "undefined" || !bootstrap.Tab) return;

  const buttons = [
    ...tabList.querySelectorAll('[data-bs-toggle="pill"][data-bs-target]'),
  ];
  if (!buttons.length) return;

  const activateFromHash = () => {
    const hash = window.location.hash;
    if (!hash) return;
    const trigger = buttons.find((button) => button.dataset.bsTarget === hash);
    if (trigger) bootstrap.Tab.getOrCreateInstance(trigger).show();
  };

  buttons.forEach((button) => {
    button.addEventListener("shown.bs.tab", () => {
      const target = button.dataset.bsTarget;
      if (target && window.location.hash !== target) {
        history.replaceState(null, "", target);
      }
    });
  });

  activateFromHash();
  window.addEventListener("hashchange", activateFromHash);
});


// ===== Admin Labs Directory & CRUD (HTML-only prototype data) =====
document.addEventListener("DOMContentLoaded", () => {
  const U = window.AdminUI;
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const clinicLabel = (select, code) => select?.querySelector(`option[value="${CSS.escape(code)}"]`)?.textContent?.replace(/^\S+\s+—\s+/,"")?.trim() || code;

  // Directory page: seeded business data is pre-rendered in admin/labs.html.
  const grid=document.getElementById("adminLabsGrid");
  if(grid){
    const search=document.getElementById("adminLabSearch"), clinic=document.getElementById("adminLabClinicFilter"), status=document.getElementById("adminLabStatusFilter"), empty=document.getElementById("adminLabsEmpty");
    const cards=()=>[...grid.querySelectorAll("[data-admin-lab-card]")];
    const updateCard = (card) => {
      card.querySelector("[data-lab-card-name]") && (card.querySelector("[data-lab-card-name]").textContent=card.dataset.name);
      card.querySelector("[data-lab-card-clinic]") && (card.querySelector("[data-lab-card-clinic]").textContent=`${card.dataset.clinic} — ${card.dataset.clinicName}`);
      card.querySelector("[data-lab-card-address]") && (card.querySelector("[data-lab-card-address]").textContent=card.dataset.address);
      card.querySelector("[data-lab-card-phone]") && (card.querySelector("[data-lab-card-phone]").textContent=card.dataset.phone);
      const badge=card.querySelector("[data-lab-card-status]"); if(badge){badge.textContent=card.dataset.status==="active"?"نشط":"مؤرشف";badge.className=`badge ${card.dataset.status==="active"?"text-bg-success":"text-bg-secondary"}`;}
      card.querySelector(".soft-card")?.classList.toggle("opacity-75",card.dataset.status==="archived");
      const tog=card.querySelector("[data-admin-lab-toggle]");if(tog){tog.title=card.dataset.status==="active"?"أرشفة":"استعادة";tog.innerHTML=`<i class="bi ${card.dataset.status==="active"?"bi-archive":"bi-arrow-counterclockwise"}"></i>`;}
      card.dataset.search=`${card.dataset.name} ${card.dataset.clinic} ${card.dataset.clinicName} ${card.dataset.phone} ${card.dataset.address}`.toLowerCase();
    };
    const render=()=>{
      const q=U?.norm(search?.value), c=clinic?.value||"all", st=status?.value||"all";let visible=0;
      cards().forEach((card)=>{const show=(!q||U.norm(card.dataset.search||card.textContent).includes(q))&&(c==="all"||card.dataset.clinic===c)&&(st==="all"||card.dataset.status===st);card.classList.toggle("d-none",!show);if(show)visible++;});
      empty?.classList.toggle("d-none",visible!==0);
      const all=cards(), total=document.getElementById("adminLabsTotal"), active=document.getElementById("adminLabsActive"), archived=document.getElementById("adminLabsArchived"), open=document.getElementById("adminLabsOpenCases");
      if(total)total.textContent=all.length;if(active)active.textContent=all.filter(x=>x.dataset.status==="active").length;if(archived)archived.textContent=all.filter(x=>x.dataset.status==="archived").length;if(open)open.textContent=all.reduce((sum,x)=>sum+Number(x.dataset.openCases||0),0);
    };
    [search,clinic,status].forEach(el=>el?.addEventListener(el===search?"input":"change",render));
    grid.addEventListener("click",(e)=>{
      const card=e.target.closest("[data-admin-lab-card]");if(!card)return;
      if(e.target.closest("[data-admin-lab-edit]")){location.href=`lab-details.html?lab=${encodeURIComponent(card.dataset.id)}&edit=1`;return;}
      if(e.target.closest("[data-admin-lab-toggle]")){card.dataset.status=card.dataset.status==="active"?"archived":"active";updateCard(card);U?.toast(card.dataset.status==="active"?"تمت استعادة المختبر في العرض الحالي.":"تمت أرشفة المختبر مع الاحتفاظ بتاريخ حالاته.","success");render();return;}
      if(e.target.closest("[data-admin-lab-delete]")){const total=Number(card.dataset.casesTotal||0);if(total>0){U?.toast(`لا يمكن حذف ${card.dataset.name} لأنه مرتبط بـ ${total} حالة. استخدم الأرشفة بدلًا من ذلك.`,"danger");return;}if(confirm(`حذف ${card.dataset.name} من العرض الحالي؟ هذا المختبر لا يملك حالات مرتبطة.`)){card.remove();U?.toast("تم حذف المختبر من العرض الحالي.","success");render();}}
    });
    document.getElementById("saveAdminNewLab")?.addEventListener("click",()=>{
      const select=document.getElementById("adminAddLabClinic"), c=select?.value, name=document.getElementById("adminAddLabName")?.value.trim(), phone=document.getElementById("adminAddLabPhone")?.value.trim(), address=document.getElementById("adminAddLabAddress")?.value.trim(), contact=document.getElementById("adminAddLabContact")?.value.trim(), notes=document.getElementById("adminAddLabNotes")?.value.trim(), reason=document.getElementById("adminAddLabReason")?.value.trim();
      if(!c||!name||!phone||!address||!reason){U?.toast("أكمل العيادة واسم المختبر والهاتف والعنوان وسبب الإضافة.","danger");return;}
      const id=`demo-lab-${Date.now()}`, cname=clinicLabel(select,c), searchText=esc(`${name} ${c} ${cname} ${phone} ${address}`.toLowerCase());
      grid.insertAdjacentHTML("beforeend",`<div class="col-md-6 col-xl-4" data-admin-lab-card data-id="${id}" data-clinic="${esc(c)}" data-clinic-name="${esc(cname)}" data-name="${esc(name)}" data-phone="${esc(phone)}" data-address="${esc(address)}" data-contact="${esc(contact||"")}" data-notes="${esc(notes||"")}" data-status="active" data-cases-total="0" data-open-cases="0" data-received-cases="0" data-overdue-cases="0" data-search="${searchText}"><div class="soft-card p-4 h-100 d-flex flex-column"><div class="d-flex justify-content-between gap-3 mb-3"><div><h5 class="fw-bold mb-1" data-lab-card-name>${esc(name)}</h5><div class="small text-secondary" data-lab-card-clinic>${esc(c)} — ${esc(cname)}</div></div><span class="badge text-bg-success" data-lab-card-status>نشط</span></div><div class="small text-secondary mb-3"><i class="bi bi-geo-alt ms-1"></i><span data-lab-card-address>${esc(address)}</span><br><i class="bi bi-telephone ms-1"></i><span data-lab-card-phone>${esc(phone)}</span></div><div class="row g-2 text-center mb-3"><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">الحالات</small><strong>0</strong></div></div><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">مفتوحة</small><strong>0</strong></div></div><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">متأخرة</small><strong>0</strong></div></div></div><div class="small text-secondary mb-3">مختبر مضاف خلال العرض الحالي؛ لا توجد له حالات وهمية بعد.</div><div class="mt-auto d-flex gap-2 flex-wrap"><button class="btn btn-light border flex-grow-1" data-toast="لا توجد تفاصيل حالات لهذا المختبر في بيانات العرض الحالية.">عرض المختبر</button><button class="btn btn-outline-secondary" data-admin-lab-toggle title="أرشفة"><i class="bi bi-archive"></i></button><button class="btn btn-outline-danger" data-admin-lab-delete title="حذف"><i class="bi bi-trash"></i></button></div></div></div>`);
      bootstrap.Modal.getInstance(document.getElementById("adminAddLabModal"))?.hide();U?.toast("تمت إضافة المختبر إلى القائمة في العرض الحالي.","success");render();
    });
    render();
  }

  // Details page: lab records/cases come from hidden HTML catalog in lab-details.html.
  const detailsPage=document.querySelector("[data-admin-lab-details-page]");
  if(detailsPage){
    const params=new URLSearchParams(location.search), id=params.get("lab")||"elite";
    let lab=[...document.querySelectorAll("[data-admin-lab-record]")].find((r)=>r.dataset.id===id) || document.querySelector("[data-admin-lab-record]");
    if(!lab)return;
    const cases=()=>[...lab.querySelectorAll("[data-admin-lab-case]")];
    const set=(i,v)=>{const el=document.getElementById(i);if(el)el.textContent=v||"—";};
    const paint=()=>{
      set("adminLabBreadcrumb",lab.dataset.name);set("adminLabDetailName",lab.dataset.name);set("adminLabDetailClinic",`${lab.dataset.clinic} — ${lab.dataset.clinicName}`);set("adminLabDetailAddress",lab.dataset.address);set("adminLabDetailPhone",lab.dataset.phone);set("adminLabInfoClinic",`${lab.dataset.clinic} — ${lab.dataset.clinicName}`);set("adminLabInfoPhone",lab.dataset.phone);set("adminLabInfoAddress",lab.dataset.address);set("adminLabInfoContact",lab.dataset.contact||"—");set("adminLabInfoNotes",lab.dataset.notes||"—");
      const active=lab.dataset.status==="active", badge=document.getElementById("adminLabDetailStatus");if(badge){badge.textContent=active?"نشط":"مؤرشف";badge.className=`badge ${active?"text-bg-success":"text-bg-secondary"}`;}
      const arc=document.getElementById("adminArchiveLabBtn");if(arc)arc.innerHTML=active?'<i class="bi bi-archive ms-1"></i>أرشفة':'<i class="bi bi-arrow-counterclockwise ms-1"></i>استعادة';
      const cc=cases();set("adminLabCaseTotal",cc.length);set("adminLabCaseOpen",cc.filter(x=>!["received","installed"].includes(x.dataset.status)).length);set("adminLabCaseReceived",cc.filter(x=>x.dataset.status==="received").length);set("adminLabCaseOverdue",cc.filter(x=>x.dataset.overdue==="true").length);
      const ids={adminEditLabClinic:lab.dataset.clinic,adminEditLabName:lab.dataset.name,adminEditLabPhone:lab.dataset.phone,adminEditLabAddress:lab.dataset.address,adminEditLabContact:lab.dataset.contact||"",adminEditLabNotes:lab.dataset.notes||""};Object.entries(ids).forEach(([i,v])=>{const e=document.getElementById(i);if(e)e.value=v;});
    };
    const renderCases=()=>{const body=document.getElementById("adminLabCasesBody"),empty=document.getElementById("adminLabCasesEmpty"),q=U?.norm(document.getElementById("adminLabCaseSearch")?.value);const rows=cases().filter(c=>!q||U.norm(`${c.dataset.id} ${c.dataset.patient} ${c.dataset.doctor} ${c.dataset.work}`).includes(q));if(body)body.innerHTML=rows.map(c=>`<tr><td><strong>${esc(c.dataset.id)}</strong></td><td>${esc(c.dataset.patient)}</td><td>${esc(c.dataset.doctor)}</td><td>${esc(c.dataset.work)}</td><td><span class="badge ${c.dataset.status==='received'?'text-bg-success':c.dataset.status==='installed'?'text-bg-dark':c.dataset.status==='sent'?'text-bg-info':'text-bg-secondary'}">${esc(c.dataset.statusLabel)}</span>${c.dataset.overdue==='true'?' <span class="badge text-bg-danger">متأخرة</span>':''}</td><td>${esc(c.dataset.due)}</td></tr>`).join("");empty?.classList.toggle("d-none",rows.length!==0);};
    document.getElementById("adminLabCaseSearch")?.addEventListener("input",renderCases);
    document.getElementById("saveAdminLabEdit")?.addEventListener("click",()=>{const reason=document.getElementById("adminEditLabReason")?.value.trim(), select=document.getElementById("adminEditLabClinic"), c=select?.value,name=document.getElementById("adminEditLabName")?.value.trim(),phone=document.getElementById("adminEditLabPhone")?.value.trim(),address=document.getElementById("adminEditLabAddress")?.value.trim();if(!c||!name||!phone||!address||!reason){U?.toast("أكمل الحقول المطلوبة وسبب التعديل الإداري.","danger");return;}lab.dataset.clinic=c;lab.dataset.clinicName=clinicLabel(select,c);lab.dataset.name=name;lab.dataset.phone=phone;lab.dataset.address=address;lab.dataset.contact=document.getElementById("adminEditLabContact")?.value.trim()||"";lab.dataset.notes=document.getElementById("adminEditLabNotes")?.value.trim()||"";bootstrap.Modal.getInstance(document.getElementById("adminEditLabModal"))?.hide();U?.toast("تم تحديث بيانات المختبر في العرض الحالي.","success");paint();});
    document.getElementById("adminArchiveLabBtn")?.addEventListener("click",()=>{lab.dataset.status=lab.dataset.status==="active"?"archived":"active";U?.toast(lab.dataset.status==="active"?"تمت استعادة المختبر في العرض الحالي.":"تمت أرشفة المختبر مع بقاء الحالات ظاهرة.","success");paint();});
    document.getElementById("adminDeleteLabBtn")?.addEventListener("click",()=>{const msg=document.getElementById("adminDeleteLabMessage"),confirmBtn=document.getElementById("confirmAdminLabDelete"),total=cases().length;if(total>0){if(msg)msg.innerHTML=`لا يمكن حذف <strong>${esc(lab.dataset.name)}</strong> لأنه مرتبط بـ <strong>${total}</strong> حالة مخبرية. استخدم الأرشفة للحفاظ على التاريخ.`;if(confirmBtn)confirmBtn.disabled=true;}else{if(msg)msg.innerHTML=`المختبر <strong>${esc(lab.dataset.name)}</strong> لا يملك حالات مرتبطة ويمكن حذفه من العرض الحالي.`;if(confirmBtn)confirmBtn.disabled=false;}const r=document.getElementById("adminDeleteLabReason");if(r)r.value="";bootstrap.Modal.getOrCreateInstance(document.getElementById("adminDeleteLabModal")).show();});
    document.getElementById("confirmAdminLabDelete")?.addEventListener("click",()=>{if(cases().length)return;const reason=document.getElementById("adminDeleteLabReason")?.value.trim();if(!reason){U?.toast("سبب الحذف الإداري مطلوب.","danger");return;}bootstrap.Modal.getInstance(document.getElementById("adminDeleteLabModal"))?.hide();U?.toast("تم حذف المختبر من العرض الحالي لأنه لا يملك حالات.","success");setTimeout(()=>location.href="labs.html",450);});
    paint();renderCases();if(params.get("edit")==="1")setTimeout(()=>bootstrap.Modal.getOrCreateInstance(document.getElementById("adminEditLabModal")).show(),100);
  }
});

