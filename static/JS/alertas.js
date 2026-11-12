/* =========================================================
   SMILE CLOUD · ALERTAS (SweetAlert2)
   Archivo: static/JS/alertas.js
   Requiere: SweetAlert2 y static/CSS/alertas.css
   ========================================================= */

(function () {
    "use strict";

    /* ---------- Iconos SVG propios ---------- */
    var ICONOS = {
        success:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        error:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        info:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.01"/></svg>',
        danger:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.4v.01"/></svg>'
    };

    function hayswal() {
        return typeof Swal !== "undefined";
    }

    function tipoValido(tipo) {
        return ICONOS[tipo] ? tipo : "info";
    }

    /* ---------- Aviso con un solo botón ---------- */
    // scAviso("Título", "Texto", "success" | "error" | "info")
    window.scAviso = function (titulo, texto, tipo, textoBoton) {
        tipo = tipoValido(tipo);

        if (!hayswal()) {
            window.alert(titulo + (texto ? "\n" + texto : ""));
            return Promise.resolve();
        }

        return Swal.fire({
            position: "top",
            icon: "info",
            iconHtml: ICONOS[tipo],
            title: titulo || "",
            text: texto || "",
            confirmButtonText: textoBoton || "Entendido",
            buttonsStyling: false,
            allowOutsideClick: true,
            showClass: { popup: "sc-down" },
            hideClass: { popup: "" },
            customClass: {
                popup: "sc-pop k-" + tipo,
                confirmButton: "sc-ok"
            }
        });
    };

    /* ---------- Confirmación (Sí / Cancelar) ---------- */
    // scConfirmar({titulo, texto, ok, cancelar, peligro}).then(function (acepto) { ... })
    window.scConfirmar = function (opciones) {
        opciones = opciones || {};
        var tipo = opciones.peligro ? "danger" : "info";

        if (!hayswal()) {
            return Promise.resolve(
                window.confirm(opciones.titulo || "¿Estás seguro?")
            );
        }

        return Swal.fire({
            position: "top",
            icon: "info",
            iconHtml: ICONOS[tipo],
            title: opciones.titulo || "¿Estás seguro?",
            text: opciones.texto || "",
            showCancelButton: true,
            confirmButtonText: opciones.ok || "Sí, continuar",
            cancelButtonText: opciones.cancelar || "Cancelar",
            reverseButtons: true,
            focusCancel: !!opciones.peligro,
            buttonsStyling: false,
            allowOutsideClick: true,
            showClass: { popup: "sc-down" },
            hideClass: { popup: "" },
            customClass: {
                popup: "sc-pop k-" + tipo,
                confirmButton: "sc-ok",
                cancelButton: "sc-no"
            }
        }).then(function (r) {
            return !!r.isConfirmed;
        });
    };

    /* ---------- Notificación pequeña arriba a la derecha ---------- */
    // scToast("Paciente guardado")  |  scToast("Algo falló", "error")
    window.scToast = function (titulo, tipo) {
        tipo = tipoValido(tipo === "danger" ? "error" : tipo || "success");

        if (!hayswal()) { return; }

        Swal.fire({
            toast: true,
            position: "top-end",
            icon: "info",
            iconHtml: ICONOS[tipo],
            title: titulo || "",
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true,
            customClass: { popup: "sc-toast k-" + tipo }
        });
    };

    /* ---------- Quitar ?error=... de la URL tras mostrar la alerta ---------- */
    window.scLimpiarURL = function (parametros) {
        try {
            var url = new URL(window.location.href);
            (parametros || ["error", "ok", "msg"]).forEach(function (p) {
                url.searchParams.delete(p);
            });
            window.history.replaceState({}, "", url.pathname + url.search + url.hash);
        } catch (e) { /* sin acción */ }
    };

    /* ---------- Confirmaciones automáticas con atributos data-sc-* ----------
       Funciona en enlaces <a> y formularios <form>:

         data-sc-confirm="¿Eliminar paciente?"      (obligatorio)
         data-sc-texto="Texto explicativo"
         data-sc-ok="Sí, eliminar"
         data-sc-tipo="peligro"                     (botón rojo)
    ------------------------------------------------------------------------ */
    function opcionesDesde(el) {
        return {
            titulo: el.getAttribute("data-sc-confirm"),
            texto: el.getAttribute("data-sc-texto") || "",
            ok: el.getAttribute("data-sc-ok") || "Sí, continuar",
            peligro: el.getAttribute("data-sc-tipo") === "peligro"
        };
    }

    // Enlaces
    document.addEventListener("click", function (e) {
        var enlace = e.target.closest("a[data-sc-confirm]");
        if (!enlace) { return; }

        e.preventDefault();
        var destino = enlace.getAttribute("href");

        window.scConfirmar(opcionesDesde(enlace)).then(function (acepto) {
            if (acepto && destino) { window.location.href = destino; }
        });
    });

    // Formularios
    document.addEventListener("submit", function (e) {
        var form = e.target.closest ? e.target.closest("form[data-sc-confirm]") : null;
        if (!form) { return; }

        e.preventDefault();

        window.scConfirmar(opcionesDesde(form)).then(function (acepto) {
            if (acepto) {
                // form.submit() no vuelve a disparar el evento "submit"
                HTMLFormElement.prototype.submit.call(form);
            }
        });
    });
})();