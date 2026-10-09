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
  const clinicAppointmentsList = document.getElementById("clinicAppointmentsList");
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

  clinicAppointmentsList?.addEventListener("click", (e) => {
    const accept = e.target.closest("[data-ai-demo-accept]");
    const reject = e.target.closest("[data-ai-demo-reject]");
    const button = accept || reject;
    if (!button) return;
    const card = button.closest(".appointment-item");
    const accepted = Boolean(accept);
    if (card) {
      card.dataset.status = accepted ? "confirmed" : "rejected";
      card.classList.remove("warning", "success", "danger");
      card.classList.add(accepted ? "success" : "danger");
      const statusBadge = card.querySelector("[data-ai-demo-status]");
      if (statusBadge) {
        statusBadge.className = `badge ${accepted ? "text-bg-success" : "text-bg-danger"}`;
        statusBadge.textContent = accepted ? "موعد مؤكد" : "مرفوض";
      }
      const actions = card.querySelector("[data-ai-demo-actions]");
      if (actions) actions.innerHTML = '<span class="small text-secondary">تمت معالجة الطلب في العرض الحالي</span>';
    }
    toast(accepted ? "تم قبول حجز التشخيص الذكي في العرض الحالي" : "تم رفض حجز التشخيص الذكي في العرض الحالي");
    filterAppointments();
  });

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
        (specialty === "all" ||
          (item.dataset.specialty || "").split(",").includes(specialty));
      item.classList.toggle("d-none", !show);
    });
  }
  serviceSearch?.addEventListener("input", filterServices);
  serviceSpecialty?.addEventListener("change", filterServices);

  // Service specialties: clear multi-select UX + compatible doctors only.
  const serviceSpecialtyChecks = [
    ...document.querySelectorAll(".service-specialty-check"),
  ];
  const selectedSpecialtiesCount = document.getElementById(
    "selectedSpecialtiesCount",
  );
  const serviceDoctorOptions = [
    ...document.querySelectorAll(".service-doctor-option"),
  ];

  function syncServiceSpecialties() {
    if (!serviceSpecialtyChecks.length) return;
    const selected = serviceSpecialtyChecks
      .filter((x) => x.checked)
      .map((x) => x.value);
    const count = selected.length;

    if (selectedSpecialtiesCount) {
      selectedSpecialtiesCount.textContent =
        count === 0
          ? "لم يتم اختيار تخصص"
          : count === 1
            ? "تم اختيار تخصص واحد"
            : count === 2
              ? "تم اختيار تخصصين"
              : `تم اختيار ${count} تخصصات`;
      selectedSpecialtiesCount.classList.toggle("text-bg-danger", count === 0);
      selectedSpecialtiesCount.classList.toggle("text-bg-primary", count !== 0);
    }

    serviceDoctorOptions.forEach((row) => {
      const doctorSpecialties = (row.dataset.specialties || "")
        .split(",")
        .filter(Boolean);
      const matches =
        selected.length === 0 ||
        doctorSpecialties.some((s) => selected.includes(s));
      row.classList.toggle("d-none", !matches);
      if (!matches) {
        const checkbox = row.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = false;
      }
    });
  }

  serviceSpecialtyChecks.forEach((check) =>
    check.addEventListener("change", syncServiceSpecialties),
  );
  syncServiceSpecialties();
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

  // Validate Clinic-created appointment before showing success.
  document
    .getElementById("saveClinicAppointmentBtn")
    ?.addEventListener("click", () => {
      const patient = document.getElementById("clinicBookingPatient")?.value;
      const doctor = document.getElementById("clinicBookingDoctor")?.value;
      const service = document.getElementById("clinicBookingService")?.value;
      const date = document.getElementById("clinicBookingDate")?.value;
      const slot = document.querySelector(
        ".slot-grid .time-slot.available.selected",
      );
      if (!patient || !doctor || !service || !date || !slot) {
        toast(
          "اختر المريض والطبيب والخدمة والتاريخ ووقتًا متاحًا قبل حفظ الموعد.",
          "danger",
        );
        return;
      }
      const result = document.getElementById("clinicBookingResult");
      if (result) {
        result.classList.remove("d-none");
        result.innerHTML = `<i class="bi bi-check-circle ms-1"></i><strong>تم تجهيز الموعد التجريبي.</strong> ${date} • ${slot.textContent.trim()} — سيقوم NestJS API بالتحقق مرة أخرى من توفر الـSlot قبل الحفظ.`;
      }
      toast("تم إنشاء الموعد من العيادة تجريبيًا.", "success");
    });
  ["clinicBookingDoctor", "clinicBookingDate"].forEach((id) =>
    document
      .getElementById(id)
      ?.addEventListener("change", () =>
        document
          .querySelectorAll(".slot-grid .time-slot.available")
          .forEach((x) => x.classList.remove("selected")),
      ),
  );

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

document.addEventListener("DOMContentLoaded", () => {
  const norm = (v) => (v || "").toString().trim().toLowerCase();
  const toast = (msg) => {
    const el = document.getElementById("appToast");
    if (!el) return;
    const b = el.querySelector(".toast-body");
    if (b) b.textContent = msg;
    bootstrap.Toast.getOrCreateInstance(el).show();
  };
  const search = document.getElementById("staffSearch"),
    role = document.getElementById("staffRoleFilter"),
    status = document.getElementById("staffStatusFilter"),
    empty = document.getElementById("staffEmpty");
  const rows = () => [...document.querySelectorAll("[data-staff-row]")];
  const roleSelect = document.getElementById("staffFormRole");
  const permissionLabel = (key) => {
    const input = document.querySelector(
      `.staff-permissions-grid input[value="${CSS.escape(key)}"]`,
    );
    return input?.closest("label")?.textContent.trim() || key;
  };
  const roleLabel = (key) =>
    roleSelect
      ?.querySelector(`option[value="${CSS.escape(key)}"]`)
      ?.textContent.trim() || key;
  const templatePermissions = (key) => {
    const opt = roleSelect?.querySelector(`option[value="${CSS.escape(key)}"]`);
    return (opt?.dataset.templatePermissions || "").split(",").filter(Boolean);
  };
  const updateStats = () => {
    const all = rows(),
      active = all.filter((r) => r.dataset.status === "active").length,
      susp = all.filter((r) => r.dataset.status === "suspended").length;
    const t = document.getElementById("staffTotal"),
      a = document.getElementById("staffActive"),
      su = document.getElementById("staffSuspended");
    if (t) t.textContent = all.length;
    if (a) a.textContent = active;
    if (su) su.textContent = susp;
  };
  const filter = () => {
    if (!empty) return;
    const q = norm(search?.value),
      r = role?.value || "all",
      st = status?.value || "all";
    let n = 0;
    rows().forEach((row) => {
      const ok =
        (!q ||
          norm((row.dataset.search || "") + " " + row.textContent).includes(
            q,
          )) &&
        (r === "all" || row.dataset.role === r) &&
        (st === "all" || row.dataset.status === st);
      row.classList.toggle("d-none", !ok);
      if (ok) n++;
    });
    empty.classList.toggle("d-none", n !== 0);
  };
  search?.addEventListener("input", filter);
  role?.addEventListener("change", filter);
  status?.addEventListener("change", filter);
  let editing = null;
  document.querySelector("[data-staff-new]")?.addEventListener("click", () => {
    editing = null;
    const title = document.getElementById("staffModalTitle");
    if (title) title.textContent = "إضافة موظف";
    ["staffFormName", "staffFormEmail", "staffFormPhone"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    if (roleSelect) roleSelect.selectedIndex = 0;
    const st = document.getElementById("staffFormStatus");
    if (st) st.selectedIndex = 0;
    document
      .querySelectorAll(".staff-permissions-grid input")
      .forEach((c) => (c.checked = false));
  });
  const applyTemplate = () => {
    const key = roleSelect?.value || "";
    const allowed = templatePermissions(key);
    document
      .querySelectorAll(".staff-permissions-grid input")
      .forEach((c) => (c.checked = allowed.includes(c.value)));
  };
  document
    .getElementById("applyRoleTemplate")
    ?.addEventListener("click", applyTemplate);
  roleSelect?.addEventListener("change", applyTemplate);
  document.addEventListener("click", (e) => {
    const view = e.target.closest("[data-staff-view]");
    if (view) {
      const row = view.closest("[data-staff-row]");
      if (!row) return;
      const name = document.getElementById("staffViewName"),
        r = document.getElementById("staffViewRole"),
        email = document.getElementById("staffViewEmail"),
        st = document.getElementById("staffViewStatus"),
        perms = document.getElementById("staffViewPermissions");
      if (name)
        name.textContent =
          row.querySelector("[data-staff-name]")?.textContent.trim() || "";
      if (r)
        r.textContent =
          row.querySelector("[data-staff-role-label]")?.textContent.trim() ||
          "";
      if (email)
        email.textContent =
          row.querySelector("[data-staff-email]")?.textContent.trim() || "";
      if (st)
        st.textContent =
          row.querySelector("[data-staff-badge]")?.textContent.trim() || "";
      if (perms) {
        perms.innerHTML = "";
        (row.dataset.permissions || "")
          .split(",")
          .filter(Boolean)
          .forEach((key) => {
            const b = document.createElement("span");
            b.className = "badge text-bg-light border";
            b.textContent = permissionLabel(key);
            perms.appendChild(b);
          });
      }
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("staffViewModal"),
      ).show();
    }
    const edit = e.target.closest("[data-staff-edit]");
    if (edit) {
      editing = edit.closest("[data-staff-row]");
      if (!editing) return;
      const title = document.getElementById("staffModalTitle");
      if (title) title.textContent = "تعديل الموظف";
      const name = document.getElementById("staffFormName"),
        email = document.getElementById("staffFormEmail"),
        rs = document.getElementById("staffFormRole"),
        ss = document.getElementById("staffFormStatus");
      if (name)
        name.value =
          editing.querySelector("[data-staff-name]")?.textContent.trim() || "";
      if (email)
        email.value =
          editing.querySelector("[data-staff-email]")?.textContent.trim() || "";
      if (rs) rs.value = editing.dataset.role || "";
      if (ss) ss.value = editing.dataset.status || "";
      const allowed = (editing.dataset.permissions || "")
        .split(",")
        .filter(Boolean);
      document
        .querySelectorAll(".staff-permissions-grid input")
        .forEach((c) => (c.checked = allowed.includes(c.value)));
      bootstrap.Modal.getOrCreateInstance(
        document.getElementById("staffModal"),
      ).show();
    }
    const tog = e.target.closest("[data-staff-toggle]");
    if (tog) {
      const row = tog.closest("[data-staff-row]");
      if (!row) return;
      const suspend = row.dataset.status === "active";
      row.dataset.status = suspend ? "suspended" : "active";
      const b = row.querySelector("[data-staff-badge]");
      if (b) {
        b.textContent = suspend ? "معلق" : "فعال";
        b.className = `badge ${suspend ? "text-bg-secondary" : "text-bg-success"}`;
      }
      tog.textContent = suspend ? "إعادة تفعيل" : "تعليق";
      tog.className = `btn btn-sm ${suspend ? "btn-outline-success" : "btn-outline-warning"}`;
      toast(
        "تم تغيير الحالة بصريًا فقط؛ القيمة الأصلية موجودة في HTML وسيحفظها NestJS API لاحقًا.",
      );
      updateStats();
      filter();
    }
    const arc = e.target.closest("[data-staff-archive]");
    if (arc) {
      toast(
        "واجهة فقط: الأرشفة/الحذف الفعلي سيتم من NestJS API، ولم يتم حذف بيانات HTML الثابتة.",
      );
    }
  });
  document.getElementById("saveStaffBtn")?.addEventListener("click", () => {
    const name = document.getElementById("staffFormName")?.value.trim(),
      email = document.getElementById("staffFormEmail")?.value.trim();
    if (!name || !email) {
      toast("الاسم والبريد مطلوبان");
      return;
    }
    const modal = document.getElementById("staffModal");
    if (modal) bootstrap.Modal.getOrCreateInstance(modal).hide();
    toast(
      "تم التحقق من نموذج الموظف فقط. لن ينشئ JavaScript أو يعدّل أي سجل؛ الحفظ الحقيقي سيكون عبر NestJS API.",
    );
  });
  updateStats();
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

document.addEventListener("DOMContentLoaded", () => {
  // V24 — clinic working-hours editor. UI only; the backend will persist each period as one clinic_working_hours row.
  document.querySelectorAll(".working-day-card").forEach((card) => {
    const toggle = card.querySelector(".working-day-toggle");
    const periods = card.querySelector(".working-periods");
    const addBtn = card.querySelector(".add-working-period");

    const syncDay = () => {
      const enabled = !!toggle?.checked;
      card
        .querySelectorAll(".working-period-input,.remove-working-period")
        .forEach((el) => (el.disabled = !enabled));
      if (addBtn) addBtn.disabled = !enabled;
      const label = toggle
        ?.closest(".form-check")
        ?.querySelector(".form-check-label");
      if (label) label.textContent = enabled ? "يوم عمل" : "مغلق";
    };

    toggle?.addEventListener("change", syncDay);
    syncDay();

    addBtn?.addEventListener("click", () => {
      periods?.querySelector(".working-day-empty")?.remove();
      const wrapper = document.createElement("div");
      wrapper.className = "row g-2 align-items-end working-period-row mb-2";
      wrapper.innerHTML =
        '<div class="col-md-5"><label class="form-label small">من</label><input class="form-control working-period-input" type="time" value="09:00"></div><div class="col-md-5"><label class="form-label small">إلى</label><input class="form-control working-period-input" type="time" value="17:00"></div><div class="col-md-2"><button class="btn btn-outline-danger w-100 remove-working-period" type="button">حذف</button></div>';
      periods?.appendChild(wrapper);
    });

    periods?.addEventListener("click", (e) => {
      const remove = e.target.closest(".remove-working-period");
      if (!remove) return;
      remove.closest(".working-period-row")?.remove();
      if (periods && !periods.querySelector(".working-period-row")) {
        periods.insertAdjacentHTML(
          "beforeend",
          '<div class="small text-secondary working-day-empty">لا توجد فترات عمل لهذا اليوم.</div>',
        );
      }
    });
  });
});


// ===== Labs directory & lab cases (HTML-only prototype data) =====
document.addEventListener("DOMContentLoaded", () => {
  const toast = (msg) => {
    const el = document.getElementById("appToast");
    if (!el) return;
    const body = el.querySelector(".toast-body");
    if (body) body.textContent = msg;
    bootstrap.Toast.getOrCreateInstance(el).show();
  };
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
  const slug = (value) => String(value || "lab").trim().toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g,"-").replace(/^-|-$/g,"") || `lab-${Date.now()}`;

  // Directory page: all demo business data lives on the HTML cards.
  const search = document.getElementById("labSearch");
  const buttons = [...document.querySelectorAll("[data-lab-filter]")];
  const empty = document.getElementById("labsEmpty");
  const grid = document.getElementById("labsGrid");
  let labFilter = "active";
  const cards = () => [...document.querySelectorAll("[data-lab-card]")];
  const updateLabCounts = () => {
    const list = cards();
    const a = document.getElementById("activeLabsCount");
    const ar = document.getElementById("archivedLabsCount");
    if (a) a.textContent = list.filter((c) => c.dataset.status === "active").length;
    if (ar) ar.textContent = list.filter((c) => c.dataset.status === "archived").length;
  };
  const filterLabs = () => {
    const list = cards();
    if (!list.length) return;
    const q = (search?.value || "").trim().toLowerCase();
    let visible = 0;
    list.forEach((card) => {
      const matchesState = labFilter === "all" || card.dataset.status === labFilter;
      const matchesText = !q || (card.dataset.search || card.textContent).toLowerCase().includes(q);
      const show = matchesState && matchesText;
      card.classList.toggle("d-none", !show);
      if (show) visible++;
    });
    empty?.classList.toggle("d-none", visible !== 0);
  };
  buttons.forEach((btn) => btn.addEventListener("click", () => {
    buttons.forEach((b) => { b.classList.remove("btn-primary"); b.classList.add("btn-light"); });
    btn.classList.remove("btn-light"); btn.classList.add("btn-primary");
    labFilter = btn.dataset.labFilter || "active";
    filterLabs();
  }));
  search?.addEventListener("input", filterLabs);
  grid?.addEventListener("click", (event) => {
    const archive = event.target.closest("[data-lab-archive]");
    const restore = event.target.closest("[data-lab-restore]");
    const card = (archive || restore)?.closest("[data-lab-card]");
    if (!card) return;
    if (archive) {
      if (!confirm("سيتم إيقاف إسناد حالات جديدة لهذا المختبر. الحالات السابقة ستبقى محفوظة. متابعة الأرشفة؟")) return;
      card.dataset.status = "archived";
      card.querySelector(".soft-card")?.classList.add("opacity-75");
      const badge = card.querySelector(".badge"); if (badge) { badge.textContent = "مؤرشف"; badge.className = "badge text-bg-secondary align-self-start"; }
      archive.outerHTML = '<button class="btn btn-outline-success" data-lab-restore title="استعادة المختبر"><i class="bi bi-arrow-counterclockwise"></i></button>';
      toast("تم أرشفة المختبر في العرض الحالي مع الاحتفاظ بحالاته السابقة.");
    } else {
      card.dataset.status = "active";
      card.querySelector(".soft-card")?.classList.remove("opacity-75");
      const badge = card.querySelector(".badge"); if (badge) { badge.textContent = "نشط"; badge.className = "badge text-bg-success align-self-start"; }
      restore.outerHTML = '<button class="btn btn-outline-secondary" data-lab-archive title="أرشفة المختبر"><i class="bi bi-archive"></i></button>';
      toast("تمت استعادة المختبر وأصبح متاحًا للحالات الجديدة في العرض الحالي.");
    }
    updateLabCounts(); filterLabs();
  });
  document.getElementById("saveNewLab")?.addEventListener("click", () => {
    const name = document.getElementById("newLabName")?.value.trim();
    const phone = document.getElementById("newLabPhone")?.value.trim();
    const address = document.getElementById("newLabAddress")?.value.trim() || "العنوان غير محدد";
    if (!name || !phone) { toast("أدخل اسم المختبر ورقم الهاتف أولاً."); return; }
    const id = `${slug(name)}-${Date.now()}`;
    grid?.insertAdjacentHTML("beforeend", `<div class="col-md-6 col-xl-4 lab-card-item" data-lab-card data-lab-id="${esc(id)}" data-lab-name="${esc(name)}" data-lab-address="${esc(address)}" data-lab-phone="${esc(phone)}" data-status="active" data-search="${esc(`${name} ${address} ${phone}`.toLowerCase())}"><div class="soft-card p-4 h-100 d-flex flex-column"><div class="d-flex justify-content-between gap-3 mb-3"><div class="d-flex gap-3"><div class="rounded-4 bg-primary-subtle text-primary p-3"><i class="bi bi-building fs-4"></i></div><div><h5 class="fw-bold mb-1">${esc(name)}</h5><div class="small text-secondary">${esc(address)} • ${esc(phone)}</div></div></div><span class="badge text-bg-success align-self-start">نشط</span></div><div class="row g-2 mb-3 text-center"><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">مفتوحة</small><strong>0</strong></div></div><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">مستلمة</small><strong>0</strong></div></div><div class="col-4"><div class="border rounded-3 p-2"><small class="text-secondary d-block">متأخرة</small><strong>0</strong></div></div></div><div class="small text-secondary mb-3">مختبر أضيف خلال العرض الحالي ولم تُنشأ له حالات بعد.</div><div class="mt-auto d-flex gap-2"><button class="btn btn-light border flex-grow-1" type="button" data-toast="لا توجد حالات لهذا المختبر في بيانات العرض الحالية.">عرض المختبر</button><button class="btn btn-outline-secondary" data-lab-archive title="أرشفة المختبر"><i class="bi bi-archive"></i></button></div></div></div>`);
    bootstrap.Modal.getInstance(document.getElementById("addLabModal"))?.hide();
    ["newLabName","newLabPhone","newLabAddress","newLabContact","newLabNotes"].forEach((id) => { const el=document.getElementById(id); if(el)el.value=""; });
    updateLabCounts(); filterLabs();
    toast("تمت إضافة المختبر إلى القائمة في العرض الحالي.");
  });
  updateLabCounts(); filterLabs();

  // Lab details: records and case rows are authored in HTML; JS only filters/updates the current DOM.
  const detailsPage = document.querySelector("[data-lab-details-page]");
  const detailLabKey = detailsPage ? (new URLSearchParams(location.search).get("lab") || "elite") : null;
  const records = [...document.querySelectorAll("[data-clinic-lab-record]")];
  const recordById = (id) => records.find((r) => r.dataset.id === id) || records[0];
  let currentRecord = detailLabKey ? recordById(detailLabKey) : null;
  const activeRecords = () => records.filter((r) => r.dataset.status === "active");

  const caseSearch = document.getElementById("labCaseSearch");
  const caseStatus = document.getElementById("labCaseStatus");
  const caseDoctor = document.getElementById("labCaseDoctor");
  const cases = [...document.querySelectorAll("[data-lab-case]")];
  const casesEmpty = document.getElementById("labCasesEmpty");
  const filterCases = () => {
    if (!cases.length) return;
    const q = (caseSearch?.value || "").trim().toLowerCase();
    const st = caseStatus?.value || "all";
    const doctor = caseDoctor?.value || "all";
    let visible = 0;
    cases.forEach((row) => {
      const show = (!detailLabKey || row.dataset.lab === detailLabKey) && (!q || (row.dataset.search || row.textContent).toLowerCase().includes(q)) && (st === "all" || row.dataset.status === st) && (doctor === "all" || row.dataset.doctor === doctor);
      row.classList.toggle("d-none", !show); if (show) visible++;
    });
    casesEmpty?.classList.toggle("d-none", visible !== 0);
    if (detailLabKey) {
      const own = cases.filter((r) => r.dataset.lab === detailLabKey);
      const total=document.getElementById("labCasesTotal"), sent=document.getElementById("labCasesSent"), rec=document.getElementById("labCasesReceived"), over=document.getElementById("labCasesOverdue");
      if(total) total.textContent=own.length;
      if(sent) sent.textContent=own.filter((r)=>r.dataset.status==="sent").length;
      if(rec) rec.textContent=own.filter((r)=>r.dataset.status==="received").length;
      if(over) over.textContent=own.filter((r)=>r.textContent.includes("متأخرة")).length;
    }
  };
  [caseSearch, caseStatus, caseDoctor].forEach((el) => el?.addEventListener(el === caseSearch ? "input" : "change", filterCases));
  filterCases();
  document.querySelectorAll("[data-lab-case-action]").forEach((btn) => btn.addEventListener("click", () => {
    const row = btn.closest("[data-lab-case]"); const badge = row?.querySelector("[data-case-status-badge]");
    if (!row || !badge) return;
    if (btn.dataset.labCaseAction === "send") {
      row.dataset.status = "sent"; badge.className = "badge text-bg-info"; badge.textContent = "تم الإرسال";
      btn.dataset.labCaseAction = "receive"; btn.textContent = "تسجيل تم الاستلام"; row.querySelector("[data-lab-transfer]")?.remove();
      toast("تم تسجيل إرسال الحالة في العرض الحالي.");
    } else {
      row.dataset.status = "received"; badge.className = "badge text-bg-success"; badge.textContent = "تم الاستلام";
      btn.replaceWith(Object.assign(document.createElement("span"), {className:"small text-secondary", textContent:"بانتظار الطبيب لتسجيل التركيب"}));
      toast("تم تسجيل استلام الحالة في العرض الحالي.");
    }
    filterCases();
  }));

  let transferRow = null;
  const transferModalEl = document.getElementById("transferLabModal");
  const transferSelect = document.getElementById("transferLabSelect");
  const transferCaseLabel = document.getElementById("transferLabCaseLabel");
  document.querySelectorAll("[data-lab-transfer]").forEach((btn) => btn.addEventListener("click", () => {
    const row = btn.closest("[data-lab-case]");
    if (!row) return;
    if (row.dataset.status !== "waiting") { toast("يمكن نقل الحالة فقط قبل تسجيل الإرسال."); return; }
    transferRow = row;
    const currentLab = row.dataset.lab;
    const caseId = row.querySelector("strong")?.textContent?.trim() || "الحالة";
    if (transferCaseLabel) transferCaseLabel.textContent = `${caseId} — اختر المختبر الجديد.`;
    if (transferSelect) transferSelect.innerHTML = activeRecords().filter((r) => r.dataset.id !== currentLab).map((r) => `<option value="${esc(r.dataset.id)}">${esc(r.dataset.name)}</option>`).join("");
    if (transferModalEl) bootstrap.Modal.getOrCreateInstance(transferModalEl).show();
  }));
  document.getElementById("confirmLabTransfer")?.addEventListener("click", () => {
    if (!transferRow || !transferSelect?.value) return;
    const target = recordById(transferSelect.value);
    const caseId = transferRow.querySelector("strong")?.textContent?.trim() || "الحالة";
    transferRow.dataset.lab = transferSelect.value;
    bootstrap.Modal.getInstance(transferModalEl)?.hide();
    toast(`تم نقل ${caseId} إلى ${target?.dataset.name || "المختبر الجديد"} في العرض الحالي.`);
    transferRow = null;
    filterCases();
  });

  if (detailsPage && currentRecord) {
    const paintHeader = () => {
      const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v||"—";};
      set("labDetailName",currentRecord.dataset.name); set("labDetailAddress",currentRecord.dataset.address); set("labDetailPhone",currentRecord.dataset.phone);
      const st=document.getElementById("labDetailStatus"); if(st){const active=currentRecord.dataset.status==="active";st.textContent=active?"نشط":"مؤرشف";st.className=`badge ${active?"text-bg-success":"text-bg-secondary"}`;}
      const arc=document.getElementById("archiveCurrentLab"); if(arc){const active=currentRecord.dataset.status==="active";arc.innerHTML=active?'<i class="bi bi-archive ms-1"></i>أرشفة المختبر':'<i class="bi bi-arrow-counterclockwise ms-1"></i>استعادة المختبر';arc.className=active?"btn btn-outline-secondary":"btn btn-outline-success";}
      const values={editLabName:currentRecord.dataset.name,editLabPhone:currentRecord.dataset.phone,editLabAddress:currentRecord.dataset.address,editLabContact:currentRecord.dataset.contact||"",editLabNotes:currentRecord.dataset.notes||""};
      Object.entries(values).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v;});
    };
    paintHeader();
    document.getElementById("archiveCurrentLab")?.addEventListener("click",()=>{ currentRecord.dataset.status=currentRecord.dataset.status==="active"?"archived":"active"; paintHeader(); toast(currentRecord.dataset.status==="active"?"تمت استعادة المختبر في العرض الحالي.":"تمت أرشفة المختبر في العرض الحالي؛ تبقى الحالات السابقة ظاهرة."); });
    document.getElementById("saveClinicLabEdit")?.addEventListener("click",()=>{
      const name=document.getElementById("editLabName")?.value.trim(), phone=document.getElementById("editLabPhone")?.value.trim(), address=document.getElementById("editLabAddress")?.value.trim();
      if(!name||!phone||!address){toast("أكمل اسم المختبر والهاتف والعنوان.");return;}
      currentRecord.dataset.name=name; currentRecord.dataset.phone=phone; currentRecord.dataset.address=address; currentRecord.dataset.contact=document.getElementById("editLabContact")?.value.trim()||""; currentRecord.dataset.notes=document.getElementById("editLabNotes")?.value.trim()||"";
      bootstrap.Modal.getInstance(document.getElementById("editLabModal"))?.hide(); paintHeader(); toast("تم تحديث بيانات المختبر في العرض الحالي.");
    });
  }
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

// Front-end prototype: show the selected treatment plan using mock data embedded in HTML.
document.addEventListener("DOMContentLoaded", () => {
  const page = document.getElementById("clinicTreatmentPlanDetailPage");
  if (!page) return;
  const params = new URLSearchParams(location.search);
  const key = params.get("plan") || "ahmad";
  const catalog = document.getElementById("clinicTreatmentPlanCatalog");
  const record = catalog?.querySelector(`[data-plan-record="${CSS.escape(key)}"]`) || catalog?.querySelector('[data-plan-record="ahmad"]');
  if (!record) return;
  const d = record.dataset;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? "—"; };
  const statusClass = d.status === "completed" ? "text-bg-success" : d.status === "paused" ? "text-bg-warning" : "text-bg-primary";
  set("clinicPlanPatientCrumb", d.patient); set("clinicPlanCrumbTitle", d.title); set("clinicPlanTitle", d.title);
  set("clinicPlanSubtitle", `المريض ${d.patient} • ${d.code} • الطبيب المسؤول ${d.doctor}`);
  set("clinicPlanProgress", `${d.progress}%`); set("clinicPlanProgressStrong", `${d.progress}%`); set("clinicPlanStart", d.start); set("clinicPlanCost", d.cost); set("clinicPlanNotes", d.notes); set("clinicPlanNext", d.next); set("clinicPlanUpdated", d.updated);
  const status = document.getElementById("clinicPlanStatus"); if (status) { status.textContent = d.statusLabel; status.className = `badge ${statusClass} fs-6`; }
  const bar = document.getElementById("clinicPlanProgressBar"); if (bar) bar.style.width = `${Number(d.progress || 0)}%`;
  const patientHref = `patient-details.html?patient=${encodeURIComponent(d.patientKey || "ahmad")}`;
  const p1 = document.getElementById("clinicPlanPatientLink"); if (p1) p1.href = patientHref;
  const p2 = document.getElementById("clinicPlanPatientLinkCrumb"); if (p2) p2.href = patientHref;
  const dl = document.getElementById("clinicPlanDoctorLink"); if (dl) dl.href = `doctor-details.html?doctor=${encodeURIComponent(d.doctorKey || "omar")}`;
  const body = document.getElementById("clinicPlanSteps");
  if (body) body.innerHTML = [...record.querySelectorAll("[data-plan-record-step]")].map((x, i) => `<tr><td>${i+1}</td><td>${x.dataset.tooth || "—"}</td><td>${x.dataset.treatment || "—"}</td><td><span class="badge ${x.dataset.state === "مكتمل" ? "text-bg-success" : x.dataset.state === "قادم" ? "text-bg-primary" : "text-bg-secondary"}">${x.dataset.state || "مخطط"}</span></td></tr>`).join("");
});


// HTML-only patient/doctor detail catalogs
document.addEventListener("DOMContentLoaded",()=>{
  if(document.querySelector("[data-clinic-patient-details]")){const id=new URLSearchParams(location.search).get("patient")||"ahmad",r=[...document.querySelectorAll("[data-clinic-patient-record]")].find(x=>x.dataset.id===id)||document.querySelector("[data-clinic-patient-record]");if(r){const set=(i,v)=>{const e=document.getElementById(i);if(e)e.textContent=v||"—"};set("clinicPatientBreadcrumb",r.dataset.name);set("clinicPatientAvatar",r.dataset.avatar);set("clinicPatientName",r.dataset.name);set("clinicPatientMeta",`${r.dataset.code} • ${r.dataset.phone} • ${r.dataset.email}`);set("clinicPatientBlood",r.dataset.blood);set("clinicPatientAllergy",r.dataset.allergy);set("clinicPatientChronic",r.dataset.chronic);set("clinicPatientMeds",r.dataset.meds);set("clinicPatientNotes",r.dataset.notes);const ap=document.getElementById("clinicPatientNewAppointment");if(ap)ap.href=`new-appointment.html?patient=${encodeURIComponent(r.dataset.id)}`;
    const pt=document.getElementById("clinicPatientPlanTitle"),ps=document.getElementById("clinicPatientPlanStatus"),pb=document.getElementById("clinicPatientPlanBar"),pi=document.getElementById("clinicPatientPlanInfo"),pl=document.getElementById("clinicPatientPlanLink");if(pt)pt.textContent=r.dataset.planTitle||"—";if(ps)ps.textContent=r.dataset.planStatus||"—";if(pb)pb.style.width=`${Number(r.dataset.planProgress||0)}%`;if(pi)pi.textContent=r.dataset.planInfo||"—";if(pl){pl.classList.toggle("d-none",!r.dataset.plan);if(r.dataset.plan)pl.href=`treatment-plan-details.html?plan=${encodeURIComponent(r.dataset.plan)}`;}document.querySelectorAll("[data-plan-ahmad-detail]").forEach(el=>el.classList.toggle("d-none",id!=="ahmad"));
    const vb=document.getElementById("clinicPatientVisitsBody"),vr=document.querySelector(`[data-clinic-visits-record][data-patient="${CSS.escape(id)}"]`);if(vb&&vr){vb.innerHTML=[...vr.querySelectorAll("[data-visit]")].map(v=>`<tr><td data-label="التاريخ">${v.dataset.date}</td><td data-label="الطبيب">${v.dataset.doctor}</td><td data-label="الخدمة">${v.dataset.service}</td><td data-label="حالة الزيارة"><span class="badge text-bg-success">${v.dataset.status}</span></td><td data-label="التقرير الطبي"><span class="badge text-bg-success">${v.dataset.report}</span></td><td data-label="الإجراء"><a class="btn btn-sm btn-outline-primary" href="doctor-report.html?report=${encodeURIComponent(v.dataset.reportId||"root-canal-oct3")}">عرض التقرير</a></td></tr>`).join("");}}}
  if(document.querySelector("[data-clinic-doctor-details]")){const id=new URLSearchParams(location.search).get("doctor")||"omar",r=[...document.querySelectorAll("[data-clinic-doctor-record]")].find(x=>x.dataset.id===id)||document.querySelector("[data-clinic-doctor-record]");if(r){const set=(i,v)=>{const e=document.getElementById(i);if(e)e.textContent=v||"—"};set("clinicDoctorBreadcrumb",r.dataset.name);set("clinicDoctorName",r.dataset.name);set("clinicDoctorSpecialty",r.dataset.specialty);set("clinicDoctorMeta",r.dataset.meta);set("clinicDoctorScheduleOwner",r.dataset.name);const img=document.getElementById("clinicDoctorImage");if(img)img.src=r.dataset.image;}}
});

// Clinic medical report viewer: keep report selection and patient return path consistent in the HTML prototype.
document.addEventListener("DOMContentLoaded",()=>{
  if(!document.querySelector("[data-clinic-report-details]")) return;
  const reportId=new URLSearchParams(location.search).get("report")||"root-canal-oct3";
  const records=[...document.querySelectorAll("[data-report-record]")];
  const r=records.find(x=>x.dataset.id===reportId)||records[0];
  if(!r) return;
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value||"—";};
  set("clinicReportCode",r.dataset.code);
  set("clinicReportDate",r.dataset.date);
  set("clinicReportVisitLabel",r.dataset.visitLabel);
  set("clinicReportPatient",r.dataset.patient);
  set("clinicReportPatientCode",r.dataset.patientCode);
  set("clinicReportDoctor",r.dataset.doctor);
  set("clinicReportSpecialty",r.dataset.specialty);
  set("clinicReportService",r.dataset.service);
  set("clinicReportTooth",r.dataset.tooth);
  set("clinicReportReason",r.dataset.reason);
  set("clinicReportExam",r.dataset.exam);
  set("clinicReportDiagnosis",r.dataset.diagnosis);
  set("clinicReportProcedure",r.dataset.procedure);
  set("clinicReportPrescription",r.dataset.prescription);
  set("clinicReportFollowupType",r.dataset.followup);
  set("clinicReportFollowupDate",r.dataset.followupDate);
  set("clinicReportFollowupStatus",r.dataset.followupStatus);
  set("clinicReportAttachmentOne",r.dataset.attachmentOne);
  set("clinicReportAttachmentOneMeta",r.dataset.attachmentOneMeta);
  set("clinicReportAttachmentTwo",r.dataset.attachmentTwo);
  set("clinicReportAttachmentTwoMeta",r.dataset.attachmentTwoMeta);
  set("clinicReportDoctorSignature",r.dataset.doctor);
  set("clinicReportApprovalDate",`تم الاعتماد إلكترونياً بتاريخ ${r.dataset.date}`);
  const plan=document.getElementById("clinicReportPlan");
  if(plan) plan.innerHTML=String(r.dataset.plan||"").split("|").filter(Boolean).map(x=>`<li>${x}</li>`).join("");
  const patientHref=`patient-details.html?patient=${encodeURIComponent(r.dataset.patientId||"ahmad")}`;
  const patientLink=document.getElementById("clinicReportPatientLink");
  if(patientLink){patientLink.href=patientHref;patientLink.textContent=r.dataset.patient||"ملف المريض";}
  const back=document.getElementById("clinicReportBackLink");
  if(back) back.href=patientHref;
});

