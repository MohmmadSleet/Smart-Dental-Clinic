/* ux.js — تحسينات تجربة المستخدم المشتركة (لا تعتمد على app.js) */
(function () {
  "use strict";
  function ready(fn) { document.readyState !== "loading" ? fn() : document.addEventListener("DOMContentLoaded", fn); }

  ready(function () {
    // 1) رابط تخطي إلى المحتوى (إمكانية وصول)
    var main = document.querySelector("main");
    if (main) {
      if (!main.id) main.id = "main-content";
      var skip = document.createElement("a");
      skip.className = "ux-skip";
      skip.href = "#" + main.id;
      skip.textContent = "تخطي إلى المحتوى";
      document.body.insertBefore(skip, document.body.firstChild);
    }

    // 2) تعليم الرابط النشط للقارئات الشاشية
    document.querySelectorAll(".nav-link.active, .drawer-link.active").forEach(function (a) {
      a.setAttribute("aria-current", "page");
    });

    // 3) لف الجداول تلقائياً لتمرّر أفقياً على الجوال بدل كسر التصميم
    document.querySelectorAll("table.table").forEach(function (t) {
      if (t.closest(".table-responsive")) return;
      var w = document.createElement("div");
      w.className = "table-responsive";
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });

    // 4) علامة * على الحقول الإلزامية
    document.querySelectorAll("input[required], select[required], textarea[required]").forEach(function (el) {
      var label = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
      if (!label) {
        var box = el.closest(".col-12, [class*='col-'], .mb-3, .form-group");
        label = box && box.querySelector(".form-label");
      }
      if (label) label.classList.add("is-required");
    });

    // 5) زر العودة للأعلى
    var top = document.createElement("button");
    top.type = "button";
    top.className = "ux-top";
    top.setAttribute("aria-label", "العودة للأعلى");
    top.innerHTML = '<i class="bi bi-arrow-up"></i>';
    top.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    document.body.appendChild(top);
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        top.classList.toggle("show", window.scrollY > 500);
        ticking = false;
      });
    }, { passive: true });

    // 6) منع الإرسال المزدوج للنماذج
    document.querySelectorAll("form").forEach(function (f) {
      f.addEventListener("submit", function () {
        var b = f.querySelector('button[type="submit"], input[type="submit"]');
        if (b && f.checkValidity()) setTimeout(function () { b.disabled = true; }, 0);
      });
    });
  });
})();
