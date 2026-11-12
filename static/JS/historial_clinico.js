/* =========================================================
   HISTORIA CLÍNICA · SMILE CLOUD — ARCHIVO ÚNICO
   Parte 1: historial, evoluciones, voz y búsqueda de paciente
   Parte 2: Rx y Consentimientos informados (lógica original)
   ========================================================= */
function scToast(texto, icono = 'success') {
    if (window.Swal) {
        Swal.fire({ toast: true, position: 'top-end', icon: icono, title: texto,
                    showConfirmButton: false, timer: 2500, timerProgressBar: true });
    } else {
        console.log('[Aviso]', texto);
    }
}

function scAviso(titulo, texto, icono = 'info') {
    if (window.Swal) {
        Swal.fire({ title: titulo, text: texto, icon: icono, confirmButtonText: 'Entendido' });
    } else {
        alert(titulo + '\n\n' + texto);
    }
}

function scConfirmar({ titulo, texto, ok = 'Aceptar', cancelar = 'Cancelar' }) {
    if (window.Swal) {
        return Swal.fire({ title: titulo, text: texto, icon: 'question', showCancelButton: true,
                           confirmButtonText: ok, cancelButtonText: cancelar }).then(r => r.isConfirmed);
    }
    return Promise.resolve(confirm(titulo + '\n\n' + texto));
}
// ===================== PARTE 1 =====================
/* =========================================================
   HISTORIA CLÍNICA · SMILE CLOUD  (lógica nueva)
   - Buscar paciente por documento
   - Formulario médico (se crea UNA sola vez) / resumen con acceso rápido
   - Evoluciones por cita (solo odontólogo escribe; recepción consulta)
   - Dictado por voz en Evolución clínica y Observaciones adicionales
   Rx y Consentimientos siguen en historial_clinico.js
   ========================================================= */
(() => {
    'use strict';

    /* ---------- Configuración ---------- */
    const CFG = Object.assign({ rol: '', usuario: '', api: null }, window.HC_CONFIG || {});
    const ES_ODONTOLOGO = /odont/i.test(CFG.rol || '');
    const PACIENTES = window.PACIENTES_SMILE_CLOUD || [];

    const OPC = {
        sintomas: ['Dolor', 'Inflamación', 'Sangrado', 'Sensibilidad al frío', 'Sensibilidad al calor', 'Dificultad para masticar', 'Mal aliento', 'Ninguno'],
        intensidad: ['Leve', 'Moderado', 'Severo'],
        antecedentes: ['Diabetes', 'Hipertensión', 'Asma', 'Enfermedad cardíaca', 'Epilepsia', 'Problemas de coagulación', 'Ninguno', 'Otro'],
        alergias: ['No', 'Sí'],
        tiposAlergia: ['Medicamentos', 'Penicilina', 'Anestésicos', 'Látex', 'Alimentos'],
        acompanante: ['Viene solo', 'Viene acompañado'],
        motivos: ['Dolor dental', 'Revisión general', 'Limpieza', 'Caries', 'Sensibilidad dental', 'Fractura dental', 'Inflamación', 'Control', 'Otro'],
        diagnosticos: ['Caries dental', 'Gingivitis', 'Periodontitis', 'Pulpitis', 'Fractura dental', 'Sensibilidad dental', 'Ausencia dental', 'Maloclusión', 'Otro'],
        procedimientos: ['Limpieza dental', 'Restauración', 'Extracción', 'Endodoncia', 'Aplicación de flúor', 'Sellantes', 'Blanqueamiento', 'Control', 'Otro']
    };

    /* ---------- Utilidades ---------- */
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const val = id => ($('#' + id)?.value || '').trim();
    const setVal = (id, v) => { const el = $('#' + id); if (el) el.value = v ?? ''; };
    const marcados = name => $$(`input[name="${name}"]:checked`).map(i => i.value);
    const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
    const ahoraHora = () => new Date().toTimeString().slice(0, 5);
    const mostrar = (el, si) => { if (el) el.hidden = !si; };

    function calcularEdad(iso) {
        if (!iso) return null;
        const n = new Date(iso + 'T00:00:00');
        if (isNaN(n)) return null;
        const h = new Date();
        let e = h.getFullYear() - n.getFullYear();
        const m = h.getMonth() - n.getMonth();
        if (m < 0 || (m === 0 && h.getDate() < n.getDate())) e--;
        return e;
    }

    function iniciales(nombre) {
        const p = String(nombre || '').trim().split(/\s+/).filter(Boolean);
        return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || '--';
    }

    const soloDigitos = s => String(s ?? '').replace(/\D/g, '');

    // Convierte cualquier fecha (YYYY-MM-DD, "Mon, 02 Mar 2015 00:00:00 GMT", etc.) a YYYY-MM-DD
    function aISO(v) {
        if (!v) return '';
        const s = String(v);
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return isNaN(d) ? '' : d.toISOString().slice(0, 10);
    }

    // Busca en el objeto la primera clave que coincida con alguno de los patrones (así no depende del nombre exacto de la columna)
    function campo(p, patrones, excluir) {
        const claves = Object.keys(p || {});
        for (const re of patrones) {
            const k = claves.find(c => re.test(c) && !(excluir && excluir.test(c)) && p[c] !== null && p[c] !== undefined && p[c] !== '');
            if (k) return p[k];
        }
        return '';
    }

    function normalizar(p) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) return { nombre: '', documento: '', telefono: '', correo: '', nacimiento: '', eps: '', _raw: p };
        const completo = campo(p, [/^nombre_?completo$/i, /^full_?name$/i]);
        const nombres = campo(p, [/^(primer_?)?nombres?$/i]);
        const apellidos = campo(p, [/^(primer_?)?apellidos?$/i]);
        return {
            nombre: completo || [nombres, apellidos].filter(Boolean).join(' ').trim() || campo(p, [/nombre/i], /usuario|eps|tipo/i),
            documento: String(campo(p, [/^(numero_?|num_?|nro_?|no_?)?documento$/i, /documento|cedula|identificaci|^cc$|^dni$/i], /tipo/i)),
            telefono: campo(p, [/^(telefono|celular|movil)$/i, /tel|cel|movil/i], /emerg|acud/i),
            correo: campo(p, [/^(correo|email|e_?mail)$/i, /correo|mail/i]),
            nacimiento: aISO(campo(p, [/nacim/i])),
            eps: campo(p, [/^eps$/i, /eps|aseguradora|entidad/i]),
            _raw: p
        };
    }

    /* ---------- Almacenamiento (API Flask o navegador) ---------- */
    const Store = {
        get(t, d) { try { return JSON.parse(localStorage.getItem(`smile_${t}_${d}`)); } catch { return null; } },
        set(t, d, v) { localStorage.setItem(`smile_${t}_${d}`, JSON.stringify(v)); }
    };
    async function apiGet(path) {
        const r = await fetch(CFG.api + path, { headers: { Accept: 'application/json' } });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('Error ' + r.status);
        return r.json();
    }
    async function apiSend(path, body) {
        const r = await fetch(CFG.api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error('Error ' + r.status);
        return r.json().catch(() => body);
    }
    const Datos = {
        async historia(d) { return CFG.api ? apiGet(`/historia/${encodeURIComponent(d)}`) : Store.get('hc', d); },
        async guardarHistoria(d, h) { if (CFG.api) return apiSend(`/historia/${encodeURIComponent(d)}`, h); Store.set('hc', d, h); return h; },
        async evoluciones(d) { return CFG.api ? ((await apiGet(`/evoluciones/${encodeURIComponent(d)}`)) || []) : (Store.get('evo', d) || []); },
        async guardarEvolucion(d, e) {
            if (CFG.api) return apiSend(`/evoluciones/${encodeURIComponent(d)}`, e);
            const l = Store.get('evo', d) || []; l.push(e); Store.set('evo', d, l); return e;
        }
    };

    /* ---------- Estado ---------- */
    const state = { paciente: null, historia: null, evos: [], editando: false };

    /* ---------- Chips ---------- */
    function chips(id, name, valores, tipo = 'checkbox') {
        const box = $('#' + id);
        if (!box) return;
        box.innerHTML = valores.map(v =>
            `<label class="hc-chip"><input type="${tipo}" name="${name}" value="${esc(v)}"><span>${esc(v)}</span></label>`).join('');
    }

    function exclusivoNinguno(id) {
        $('#' + id).addEventListener('change', e => {
            const i = e.target;
            if (i.value === 'Ninguno' && i.checked) $$('input', $('#' + id)).forEach(o => { if (o !== i) o.checked = false; });
            else if (i.checked) $$('input[value="Ninguno"]', $('#' + id)).forEach(o => { o.checked = false; });
        });
    }

    function actualizarCondicionales() {
        mostrar($('#intensidad-dolor'), marcados('sintoma').includes('Dolor'));
        mostrar($('#antecedente-otro-wrap'), marcados('antecedente').includes('Otro'));
        mostrar($('#lista-alergias'), marcados('alergias')[0] === 'Sí');
        mostrar($('#acompanante-datos'), marcados('acompanante')[0] === 'Viene acompañado');
    }

    function initChips() {
        chips('chips-sintoma', 'sintoma', OPC.sintomas);
        chips('chips-intensidad', 'intensidad-dolor', OPC.intensidad, 'radio');
        chips('chips-antecedente', 'antecedente', OPC.antecedentes);
        chips('chips-alergias', 'alergias', OPC.alergias, 'radio');
        chips('chips-tipo-alergia', 'tipo-alergia', OPC.tiposAlergia);
        chips('chips-acompanante', 'acompanante', OPC.acompanante, 'radio');
        chips('chips-evo-motivo', 'evo-motivo', OPC.motivos);
        chips('chips-evo-diagnostico', 'evo-diagnostico', OPC.diagnosticos);
        chips('chips-evo-procedimiento', 'evo-procedimiento', OPC.procedimientos);
        exclusivoNinguno('chips-sintoma');
        exclusivoNinguno('chips-antecedente');
        ['chips-sintoma', 'chips-antecedente', 'chips-alergias', 'chips-acompanante'].forEach(id =>
            $('#' + id).addEventListener('change', actualizarCondicionales));
    }

    /* ---------- Rol ---------- */
    function aplicarRol() {
        const b = $('#hc-rol-badge');
        b.textContent = ES_ODONTOLOGO ? '🦷 Odontólogo · edición completa' : '👁 Modo consulta';
        b.classList.toggle('odonto', ES_ODONTOLOGO);
        $$('[data-solo-odontologo]').forEach(el => { if (!ES_ODONTOLOGO) el.remove(); });
        mostrar($('#btn-agregar-evolucion'), ES_ODONTOLOGO);
        mostrar($('#evo-solo-lectura'), !ES_ODONTOLOGO);
    }

    /* ---------- Pestañas ---------- */
    function initTabs() {
        $$('.hc-tab').forEach(btn => btn.addEventListener('click', () => {
            $$('.hc-tab').forEach(b => b.classList.toggle('active', b === btn));
            $$('.hc-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
        }));
    }

    /* ---------- Buscar paciente ---------- */
    // NUEVO: ahora usa SweetAlert2 (notificación si sale bien, alerta si falla)
    function mensaje(txt, ok) {
        const m = $('#mensaje-busqueda');
        if (m) { m.textContent = ''; m.className = ''; }
        if (!txt) { return; }
        if (ok) {
            scToast(txt, 'success');
        } else {
            scAviso('No se pudo buscar el paciente', txt, 'error');
        }
    }

    function limpiarPaciente() {
        state.paciente = null; state.historia = null; state.evos = [];
        mostrar($('#hc-paciente'), false);
        mostrar($('#hc-vacio'), true);
        mostrar($('#hc-paciente-chip'), false);
        mostrar($('#evo-contenido'), false);
        mostrar($('#evo-sin-paciente'), true);
        document.dispatchEvent(new CustomEvent('hc:paciente', { detail: null }));
    }

    function encontrarPaciente(doc) {
        const buscado = soloDigitos(doc) || String(doc).trim().toLowerCase();
        const lista = Array.isArray(PACIENTES) ? PACIENTES : Object.values(PACIENTES || {});
        const igual = v => (soloDigitos(v) || String(v ?? '').trim().toLowerCase()) === buscado;

        // 1) por el campo de documento detectado
        let p = lista.map(normalizar).find(x => x.documento && igual(x.documento));
        // 2) respaldo: cualquier valor del registro que coincida (objetos o filas tipo lista)
        if (!p) {
            const crudo = lista.find(r => (Array.isArray(r) ? r : Object.values(r || {})).some(v => v !== null && v !== '' && igual(v)));
            if (crudo) {
                p = normalizar(Array.isArray(crudo) ? Object.assign({}, crudo) : crudo);
                p.documento = p.documento || String(doc).trim();
            }
        }
        return p || null;
    }

    async function buscar() {
        try {
            const doc = val('buscar-documento');
            if (!doc) { mensaje('Ingrese un número de documento.', false); return; }

            const total = Array.isArray(PACIENTES) ? PACIENTES.length : Object.keys(PACIENTES || {}).length;
            if (!total) {
                mensaje('La página no recibió la lista de pacientes. Revise que la ruta de Flask envíe la variable "pacientes" a la plantilla.', false);
                limpiarPaciente();
                return;
            }

            const p = encontrarPaciente(doc);
            if (!p) {
                mensaje(`No se encontró ningún paciente con el documento ${doc} (hay ${total} pacientes cargados).`, false);
                console.info('[Historia clínica] Ejemplo de paciente recibido:', PACIENTES[0]);
                limpiarPaciente();
                return;
            }

            state.paciente = p;
            state.historia = await Datos.historia(p.documento);
            state.evos = await Datos.evoluciones(p.documento);
            mensaje('Paciente encontrado.', true);
            pintarPaciente();
            pintarHistoria();
            pintarEvoluciones();
            document.dispatchEvent(new CustomEvent('hc:paciente', { detail: p }));
        } catch (err) {
            console.error('[Historia clínica] Error al buscar:', err);
            mensaje('No se pudo completar la búsqueda: ' + (err && err.message ? err.message : err), false);
        }
    }

    function pintarPaciente() {
        const p = state.paciente;
        setVal('paciente-nombre', p.nombre);
        setVal('paciente-documento', p.documento);
        setVal('paciente-telefono', p.telefono);
        setVal('paciente-correo', p.correo);
        setVal('paciente-fecha-nacimiento', p.nacimiento);
        setVal('paciente-eps', p.eps);
        $('#paciente-avatar').textContent = iniciales(p.nombre);
        $('#paciente-titulo-nombre').textContent = p.nombre || 'Paciente';
        const edad = calcularEdad(p.nacimiento);
        $('#badge-edad').textContent = edad === null ? 'Edad no registrada' : `${edad} años`;
        mostrar($('#badge-menor'), edad !== null && edad < 18);
        $('#hc-chip-avatar').textContent = iniciales(p.nombre);
        $('#hc-chip-nombre').textContent = p.nombre;
        mostrar($('#hc-paciente-chip'), true);
        mostrar($('#hc-vacio'), false);
        mostrar($('#hc-paciente'), true);
        mostrar($('#evo-sin-paciente'), false);
        mostrar($('#evo-contenido'), true);
    }

    const esMenor = () => { const e = calcularEdad(state.paciente?.nacimiento); return e !== null && e < 18; };

    /* ---------- Historia: formulario ↔ resumen ---------- */
    function pintarHistoria() {
        const existe = !!state.historia;
        const badge = $('#badge-hc');
        badge.hidden = !existe;
        badge.textContent = '✔ Historia clínica creada';
        mostrar($('#form-historia'), !existe);
        mostrar($('#hc-resumen'), existe);
        if (existe) pintarResumen(); else prepararFormulario(false);
    }

    function prepararFormulario(edicion) {
        state.editando = edicion;
        $('#form-historia').reset();
        $$('#form-historia input[type=checkbox], #form-historia input[type=radio]').forEach(i => { i.checked = false; });
        mostrar($('#bloque-acudientes'), esMenor());
        mostrar($('#form-historia-aviso'), !edicion);
        mostrar($('#btn-cancelar-edicion'), edicion);
        mostrar($('#btn-limpiar'), !edicion);
        $('#btn-guardar').textContent = edicion ? 'Guardar cambios' : 'Guardar historia clínica';
        mostrar($('#hc-form-error'), false);
        if (edicion && state.historia) llenarFormulario(state.historia);
        actualizarCondicionales();
    }

    function marcar(name, valores) {
        const lista = Array.isArray(valores) ? valores : [valores];
        $$(`input[name="${name}"]`).forEach(i => { i.checked = lista.includes(i.value); });
    }

    function llenarFormulario(h) {
        marcar('sintoma', h.sintomas || []);
        marcar('intensidad-dolor', h.intensidadDolor || '');
        setVal('condicion-otra', h.condicionOtra);
        marcar('antecedente', h.antecedentes || []);
        setVal('antecedente-otro', h.antecedenteOtro);
        setVal('enfermedades-detalle', h.enfermedadesDetalle);
        marcar('alergias', h.alergias || '');
        marcar('tipo-alergia', h.tiposAlergia || []);
        setVal('alergia-otra', h.alergiaOtra);
        setVal('medicamentos', h.medicamentos);
        setVal('cirugias', h.cirugias);
        setVal('observaciones-medicas', h.observaciones);
        const em = h.emergencia || {};
        setVal('emerg-nombre', em.nombre); setVal('emerg-parentesco', em.parentesco); setVal('emerg-telefono', em.telefono);
        const ac = h.acompanante || {};
        marcar('acompanante', ac.viene ? 'Viene acompañado' : (ac.viene === false ? 'Viene solo' : ''));
        setVal('acomp-nombre', ac.nombre); setVal('acomp-documento', ac.documento);
        setVal('acomp-parentesco', ac.parentesco); setVal('acomp-telefono', ac.telefono);
        [1, 2].forEach(n => {
            const a = (h.acudientes || [])[n - 1] || {};
            setVal(`ac${n}-nombre`, a.nombre); setVal(`ac${n}-doc`, a.documento);
            setVal(`ac${n}-parentesco`, a.parentesco); setVal(`ac${n}-tel`, a.telefono); setVal(`ac${n}-correo`, a.correo);
        });
    }

    function leerFormulario() {
        const viene = marcados('acompanante')[0];
        const ac = n => ({
            nombre: val(`ac${n}-nombre`), documento: val(`ac${n}-doc`), parentesco: val(`ac${n}-parentesco`),
            telefono: val(`ac${n}-tel`), correo: val(`ac${n}-correo`)
        });
        const acudientes = [ac(1), ac(2)].filter(a => a.nombre || a.documento || a.telefono);
        return {
            sintomas: marcados('sintoma'),
            intensidadDolor: marcados('sintoma').includes('Dolor') ? (marcados('intensidad-dolor')[0] || '') : '',
            condicionOtra: val('condicion-otra'),
            antecedentes: marcados('antecedente'),
            antecedenteOtro: marcados('antecedente').includes('Otro') ? val('antecedente-otro') : '',
            enfermedadesDetalle: val('enfermedades-detalle'),
            alergias: marcados('alergias')[0] || '',
            tiposAlergia: marcados('alergias')[0] === 'Sí' ? marcados('tipo-alergia') : [],
            alergiaOtra: marcados('alergias')[0] === 'Sí' ? val('alergia-otra') : '',
            medicamentos: val('medicamentos'),
            cirugias: val('cirugias'),
            observaciones: val('observaciones-medicas'),
            emergencia: { nombre: val('emerg-nombre'), parentesco: val('emerg-parentesco'), telefono: val('emerg-telefono') },
            acompanante: {
                viene: viene === 'Viene acompañado' ? true : (viene === 'Viene solo' ? false : null),
                nombre: val('acomp-nombre'), documento: val('acomp-documento'),
                parentesco: val('acomp-parentesco'), telefono: val('acomp-telefono')
            },
            acudientes
        };
    }

    function validarHistoria(h) {
        $$('#form-historia .hc-invalid').forEach(e => e.classList.remove('hc-invalid'));
        const faltan = [];
        const exigir = (id, etiqueta) => { if (!val(id)) { $('#' + id).classList.add('hc-invalid'); faltan.push(etiqueta); } };
        if (!h.sintomas.length) faltan.push('síntomas actuales (marque "Ninguno" si no hay)');
        if (!h.antecedentes.length) faltan.push('antecedentes médicos (marque "Ninguno" si no hay)');
        if (!h.alergias) faltan.push('alergias (Sí / No)');
        if (h.alergias === 'Sí' && !h.tiposAlergia.length && !h.alergiaOtra) faltan.push('tipo de alergia');
        exigir('emerg-nombre', 'nombre del contacto de emergencia');
        exigir('emerg-telefono', 'teléfono del contacto de emergencia');
        if (esMenor()) {
            exigir('ac1-nombre', 'nombre del acudiente 1');
            exigir('ac1-doc', 'documento del acudiente 1');
            exigir('ac1-parentesco', 'parentesco del acudiente 1');
            exigir('ac1-tel', 'teléfono del acudiente 1');
        }
        return faltan;
    }

    async function guardarHistoria(ev) {
        ev.preventDefault();
        const err = $('#hc-form-error');
        const datos = leerFormulario();
        const faltan = validarHistoria(datos);
        if (faltan.length) {
            err.textContent = 'Complete: ' + faltan.join(', ') + '.';
            err.hidden = false;
            err.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        const ahora = new Date().toISOString();
        const previa = state.historia;
        const h = Object.assign(datos, {
            documento: state.paciente.documento,
            creadoEn: previa?.creadoEn || ahora,
            creadoPor: previa?.creadoPor || CFG.usuario || '',
            actualizadoEn: ahora
        });
        const btn = $('#btn-guardar');
        btn.disabled = true;
        try {
            state.historia = await Datos.guardarHistoria(state.paciente.documento, h) || h;
            if (!state.historia.sintomas) state.historia = h;
            state.editando = false;
            pintarHistoria();
            $('#hc-resumen').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch {
            err.textContent = 'No se pudo guardar. Intente de nuevo.';
            err.hidden = false;
        } finally { btn.disabled = false; }
    }

    /* ---------- Resumen y acceso rápido ---------- */
    const tags = (lista, vacio) => lista.length ? lista.map(t => `<span class="hc-tag">${esc(t)}</span>`).join('') : vacio;
    const dato = (l, v) => `<div><dt>${esc(l)}</dt><dd class="${v ? '' : 'vacio'}">${v ? esc(v) : 'No registrado'}</dd></div>`;

    function pintarResumen() {
        const h = state.historia;

        // Alergias
        let al;
        if (h.alergias === 'No') al = '<span class="hc-tag hc-tag-ok">Sin alergias conocidas</span>';
        else {
            const l = [...(h.tiposAlergia || []), ...(h.alergiaOtra ? [h.alergiaOtra] : [])];
            al = tags(l, '<span class="hc-tag hc-tag-neutro">Sin información</span>');
        }
        $('#quick-alergias').innerHTML = al;

        // Antecedentes
        const ant = (h.antecedentes || []).filter(a => a !== 'Otro');
        if (h.antecedenteOtro) ant.push(h.antecedenteOtro);
        $('#quick-antecedentes').innerHTML = (h.antecedentes || []).includes('Ninguno')
            ? '<span class="hc-tag hc-tag-ok">Sin antecedentes</span>'
            : tags(ant, '<span class="hc-tag hc-tag-neutro">Sin información</span>');

        // Síntomas
        const sin = (h.sintomas || []).map(s => s === 'Dolor' && h.intensidadDolor ? `Dolor ${h.intensidadDolor.toLowerCase()}` : s);
        if (h.condicionOtra) sin.push(h.condicionOtra);
        $('#quick-sintomas').innerHTML = (h.sintomas || []).includes('Ninguno')
            ? '<span class="hc-tag hc-tag-ok">Sin síntomas</span>'
            : tags(sin, '<span class="hc-tag hc-tag-neutro">Sin información</span>');

        // Meta
        const f = h.creadoEn ? new Date(h.creadoEn).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
        $('#hc-resumen-meta').textContent = f ? `Historia creada el ${f}` : '';

        // Información médica
        $('#resumen-medica').innerHTML =
            dato('Medicamentos', h.medicamentos) +
            dato('Cirugías / antecedentes importantes', h.cirugias) +
            dato('Detalle de enfermedades', h.enfermedadesDetalle) +
            dato('Observaciones', h.observaciones);

        const em = h.emergencia || {};
        $('#resumen-emergencia').innerHTML = dato('Nombre', em.nombre) + dato('Parentesco', em.parentesco) + dato('Teléfono', em.telefono);

        const ac = h.acompanante || {};
        $('#resumen-acompanante').innerHTML = ac.viene
            ? dato('Nombre', ac.nombre) + dato('Documento', ac.documento) + dato('Parentesco', ac.parentesco) + dato('Teléfono', ac.telefono)
            : `<div><dd class="vacio">${ac.viene === false ? 'Viene solo' : 'No registrado'}</dd></div>`;

        const lista = h.acudientes || [];
        mostrar($('#resumen-acudientes-wrap'), lista.length > 0);
        $('#resumen-acudientes').innerHTML = lista.map((a, i) => `
            <div class="hc-acudiente"><h3>Acudiente ${i + 1}</h3><dl class="hc-dl">
                ${dato('Nombre', a.nombre)}${dato('Documento', a.documento)}${dato('Parentesco', a.parentesco)}${dato('Teléfono', a.telefono)}${dato('Correo', a.correo)}
            </dl></div>`).join('');
    }

    /* ---------- Evoluciones ---------- */
    function pintarEvoluciones() {
        const q = val('evo-filtro').toLowerCase();
        const cont = $('#lista-evoluciones');
        const total = state.evos.length;
        $('#evo-contador').textContent = total ? `${total} ${total === 1 ? 'cita registrada' : 'citas registradas'}` : 'Sin citas registradas';

        const lista = [...state.evos]
            .sort((a, b) => (`${b.fecha} ${b.hora || ''}`).localeCompare(`${a.fecha} ${a.hora || ''}`))
            .filter(e => !q || JSON.stringify(e).toLowerCase().includes(q));

        if (!lista.length) {
            cont.innerHTML = `<p class="hc-empty">${total ? 'Ninguna evolución coincide con la búsqueda.' : 'Aún no hay evoluciones registradas.'}</p>`;
            return;
        }
        cont.innerHTML = lista.map((e, i) => {
            const d = new Date(e.fecha + 'T00:00:00');
            const dia = isNaN(d) ? '--' : d.getDate();
            const mes = isNaN(d) ? '' : d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
            const anio = isNaN(d) ? '' : d.getFullYear();
            const proximo = e.proximoControl ? new Date(e.proximoControl + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
            return `
            <article class="hc-evolution" style="animation-delay:${Math.min(i, 8) * 0.05}s">
                <div class="hc-evo-fecha"><strong>${dia}</strong><span>${esc(mes)}</span><small>${anio}</small></div>
                <div>
                    <div class="hc-evo-meta">
                        <span>${e.hora ? '🕒 ' + esc(e.hora) : ''}</span>
                        <span>Atendió: <b>${esc(e.odontologo || 'No registrado')}</b></span>
                    </div>
                    <div class="hc-evo-tags">
                        ${(e.motivos || []).map(t => `<span class="hc-evo-tag motivo">${esc(t)}</span>`).join('')}
                        ${(e.diagnosticos || []).map(t => `<span class="hc-evo-tag diag">${esc(t)}</span>`).join('')}
                        ${(e.procedimientos || []).map(t => `<span class="hc-evo-tag proc">${esc(t)}</span>`).join('')}
                    </div>
                    <div class="hc-evo-texto">
                        ${e.descripcion ? `<h4>Evolución clínica</h4><p>${esc(e.descripcion)}</p>` : ''}
                        ${e.observaciones ? `<h4>Observaciones adicionales</h4><p>${esc(e.observaciones)}</p>` : ''}
                    </div>
                    ${proximo ? `<span class="hc-evo-control">📅 Próximo control: ${esc(proximo)}</span>` : ''}
                </div>
            </article>`;
        }).join('');
    }

    function abrirFormEvolucion(abrir) {
        const f = $('#form-evolucion');
        if (!f) return;
        f.hidden = !abrir;
        if (abrir) {
            f.reset();
            $$('#form-evolucion input[type=checkbox]').forEach(i => { i.checked = false; });
            setVal('evo-fecha', hoyISO());
            setVal('evo-hora', ahoraHora());
            mostrar($('#evo-error'), false);
            f.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else detenerVoz();
    }

    async function guardarEvolucion(ev) {
        ev.preventDefault();
        if (!ES_ODONTOLOGO || !state.paciente) return;
        detenerVoz();
        const err = $('#evo-error');
        const e = {
            id: Date.now(),
            fecha: val('evo-fecha'),
            hora: val('evo-hora'),
            motivos: marcados('evo-motivo'),
            diagnosticos: marcados('evo-diagnostico'),
            procedimientos: marcados('evo-procedimiento'),
            descripcion: val('evo-descripcion'),
            observaciones: val('evo-observaciones'),
            proximoControl: val('evo-proximo-control'),
            odontologo: CFG.usuario || '',
            registradoEn: new Date().toISOString()
        };
        if (!e.fecha || !e.descripcion) {
            err.textContent = 'La fecha y la evolución clínica son obligatorias.';
            err.hidden = false;
            return;
        }
        const btn = $('#btn-guardar-evolucion');
        btn.disabled = true;
        try {
            const guardada = await Datos.guardarEvolucion(state.paciente.documento, e);
            state.evos.push(guardada && guardada.fecha ? guardada : e);
            abrirFormEvolucion(false);
            pintarEvoluciones();
        } catch {
            err.textContent = 'No se pudo guardar la evolución. Intente de nuevo.';
            err.hidden = false;
        } finally { btn.disabled = false; }
    }

    /* ---------- Dictado por voz (solo odontólogo) ---------- */
    let detenerActivo = null;
    function detenerVoz() { if (detenerActivo) detenerActivo(); }

    function comandosVoz(t) {
        return t
            .replace(/\s*\bpunto aparte\b\s*/gi, '.\n')
            .replace(/\s*\bnueva l[ií]nea\b\s*/gi, '\n');
    }

    function initVoz() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        $$('[data-voz]').forEach(btn => {
            const ta = $('#' + btn.dataset.voz);
            const est = btn.closest('.hc-voz-field').querySelector('.hc-voz-estado');
            if (!SR) {
                btn.disabled = true;
                btn.title = 'Su navegador no admite dictado por voz. Use Chrome o Edge.';
                est.textContent = 'Dictado no disponible en este navegador.';
                return;
            }
            let rec = null, base = '', fin = '', quiere = false;

            const ui = on => {
                btn.classList.toggle('grabando', on);
                btn.querySelector('.txt').textContent = on ? 'Detener' : 'Dictar';
                ta.classList.toggle('dictando', on);
                est.textContent = on ? '● Escuchando... hable con normalidad' : '';
            };
            const detener = () => {
                quiere = false;
                try { rec && rec.stop(); } catch { /* ya detenido */ }
                ui(false);
                if (detenerActivo === detener) detenerActivo = null;
            };
            const prepararBase = () => { base = ta.value; if (base && !/\s$/.test(base)) base += ' '; fin = ''; };

            function iniciar() {
                rec = new SR();
                rec.lang = 'es-CO';
                rec.continuous = true;
                rec.interimResults = true;
                prepararBase();
                quiere = true;
                detenerActivo = detener;

                rec.onresult = e => {
                    let interino = '';
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        const t = e.results[i][0].transcript;
                        if (e.results[i].isFinal) fin += comandosVoz(t.trim()) + ' ';
                        else interino += t;
                    }
                    ta.value = base + fin + interino;
                };
                rec.onerror = e => {
                    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                        quiere = false; ui(false);
                        est.textContent = 'Permiso de micrófono denegado. Actívelo en el navegador.';
                    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
                        est.textContent = 'Error de dictado: ' + e.error;
                    }
                };
                rec.onend = () => {
                    if (quiere) { // el navegador corta tras silencios: se reanuda
                        ta.value = (ta.value + ' ').replace(/\s+$/, ' ');
                        prepararBase();
                        try { rec.start(); } catch { detener(); }
                    }
                };
                try { rec.start(); ui(true); } catch { detener(); }
            }

            btn.addEventListener('click', () => {
                if (quiere) { detener(); return; }
                detenerVoz();
                iniciar();
            });
        });
    }

    /* ---------- Inicio ---------- */
    document.addEventListener('DOMContentLoaded', () => {
        initChips();
        aplicarRol();
        initTabs();
        if (ES_ODONTOLOGO) initVoz();

        $('#btn-buscar-paciente').addEventListener('click', buscar);
        $('#buscar-documento').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } });
        $('#btn-imprimir-historial').addEventListener('click', () => window.print());

        $('#form-historia').addEventListener('submit', guardarHistoria);
        $('#btn-limpiar').addEventListener('click', () => prepararFormulario(false));
        $('#btn-editar-historia').addEventListener('click', () => {
            mostrar($('#hc-resumen'), false);
            mostrar($('#form-historia'), true);
            prepararFormulario(true);
            $('#form-historia').scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        $('#btn-cancelar-edicion').addEventListener('click', pintarHistoria);

        $('#evo-filtro').addEventListener('input', pintarEvoluciones);
        if (ES_ODONTOLOGO) {
            $('#btn-agregar-evolucion').addEventListener('click', () => abrirFormEvolucion($('#form-evolucion').hidden));
            $('#btn-cancelar-evolucion').addEventListener('click', () => abrirFormEvolucion(false));
            $('#form-evolucion').addEventListener('submit', guardarEvolucion);
        }
        limpiarPaciente();
    });
})();


// ===================== PARTE 2 =====================
/* =========================================================
   RX Y CONSENTIMIENTOS INFORMADOS  (lógica original, sin cambios)
   Este archivo conserva SOLO lo de Rx y Consentimientos.
   El paciente llega desde historial_clinico_nuevo.js mediante el
   evento "hc:paciente" (detail = paciente encontrado, o null).
   Cargar DESPUÉS de historial_clinico_nuevo.js.
   ========================================================= */
document.addEventListener("DOMContentLoaded", () => {
    let pacienteActual = null;

    // ---------- Rx y documentos ----------
    document.getElementById("archivo-rx").addEventListener("change", e => {
        const lista = document.getElementById("lista-archivos");
        lista.innerHTML = "";
        Array.from(e.target.files).forEach(file => {
            const div = document.createElement("div");
            div.className = "hc-file";
            div.textContent = `📎 ${file.name}`;
            lista.appendChild(div);
        });
    });

    // =====================================================================
    // CONSENTIMIENTOS INFORMADOS
    // Los textos están en el objeto CONSENTIMIENTOS: si la clínica entrega
    // sus propios formatos, basta con reemplazar el contenido de "texto".
    // Se pueden usar {nombre}, {documento}, {profesional} y el id de cada
    // campo adicional (por ejemplo {procedimiento}).
    // =====================================================================
    const CONSENTIMIENTOS = {
        anestesia: {
            titulo: "Consentimiento informado para anestesia",
            icono: "💉",
            resumen: "Anestesia local, con sedación o general",
            campos: [
                { id: "tipo_anestesia", etiqueta: "Tipo de anestesia", tipo: "select", opciones: ["Local", "Local con sedación consciente", "General"] },
                { id: "procedimiento", etiqueta: "Procedimiento en el que se aplica", tipo: "text" }
            ],
            texto: [
                "El profesional {profesional} me explicó, en lenguaje claro, que para realizar el procedimiento odontológico ({procedimiento}) se requiere anestesia de tipo {tipo_anestesia}, cuyo fin es eliminar o disminuir el dolor y la ansiedad durante la atención.",
                "Me informaron que, aunque se aplica con todas las medidas de seguridad, pueden presentarse riesgos como: adormecimiento temporal de labio, lengua o mejilla; dolor, moretón o inflamación en el sitio de la punción; mordedura accidental de los tejidos adormecidos; mareo o desmayo; reacciones alérgicas al anestésico; alteraciones de la presión arterial o del ritmo del corazón; y, en casos poco frecuentes, lesión de un nervio con alteración prolongada de la sensibilidad. Con sedación o anestesia general pueden presentarse además náuseas, vómito, depresión respiratoria y otras complicaciones que exigen vigilancia especializada.",
                "Informé de manera veraz mis alergias, enfermedades, medicamentos que consumo, embarazo o lactancia (si aplica), consumo de alcohol, tabaco u otras sustancias, y mis antecedentes con anestesias anteriores.",
                "Me explicaron las alternativas (realizar el procedimiento sin anestesia o aplazarlo) y las consecuencias de no recibirla.",
                "Entiendo que debo seguir las indicaciones dadas: cumplir el ayuno cuando se indique, asistir con un acompañante adulto si se usa sedación o anestesia general, y no comer ni masticar hasta recuperar la sensibilidad.",
                "Tuve la oportunidad de hacer preguntas y fueron resueltas a mi satisfacción. Sé que puedo retirar este consentimiento en cualquier momento antes del procedimiento, sin que ello afecte mi atención."
            ]
        },
        cirugia: {
            titulo: "Consentimiento informado para cirugía",
            icono: "🦷",
            resumen: "Procedimientos quirúrgicos odontológicos",
            campos: [
                { id: "procedimiento", etiqueta: "Procedimiento quirúrgico", tipo: "text", ancho: "completo" },
                { id: "zona", etiqueta: "Diente o zona a intervenir", tipo: "text" }
            ],
            texto: [
                "El profesional {profesional} me explicó mi diagnóstico y el procedimiento quirúrgico odontológico que se me realizará: {procedimiento}, en la zona {zona}, así como su finalidad y los beneficios esperados.",
                "Me informaron los riesgos y posibles complicaciones, entre ellos: dolor, inflamación, moretones y sangrado posoperatorios; infección; alveolitis (\"hueso seco\"); lesión de dientes, raíces, encías o tejidos vecinos; fractura de dientes, raíces o hueso; comunicación con el seno maxilar; lesión de nervios con adormecimiento temporal o, rara vez, permanente de labio, lengua o mentón; limitación temporal para abrir la boca; cicatrización lenta o complicada; y reacciones a los medicamentos.",
                "Comprendo que la odontología no es una ciencia exacta, que el resultado depende también de mi respuesta biológica y de mis cuidados, y que no es posible garantizar un resultado específico.",
                "Me explicaron las alternativas de tratamiento, incluida la de no realizar la cirugía, y los riesgos de cada una.",
                "Autorizo al equipo tratante a modificar la técnica o a realizar procedimientos adicionales si durante la cirugía se presentan hallazgos imprevistos o una urgencia que lo requiera para proteger mi salud.",
                "Me comprometo a seguir las indicaciones antes y después de la cirugía (medicación, dieta, higiene, reposo y controles) y a informar cualquier síntoma anormal. Entiendo que el uso de anestesia se autoriza con su consentimiento independiente.",
                "Mis preguntas fueron resueltas y sé que puedo retirar este consentimiento antes del procedimiento."
            ]
        },
        imagen: {
            titulo: "Autorización para uso de imagen y grabación de consultas",
            icono: "🎥",
            resumen: "Fotografías y grabación de consultas",
            campos: [
                { id: "medios", etiqueta: "Qué se autoriza captar", tipo: "checks", opciones: ["Fotografías", "Video o grabación de la consulta"] },
                { id: "alcance", etiqueta: "Para qué se pueden usar", tipo: "checks", opciones: ["Registro en la historia clínica (uso clínico)", "Fines académicos y científicos, sin identificar al paciente", "Divulgación de la clínica (redes sociales, página web)"] }
            ],
            texto: [
                "Fui informado(a) de que algunas consultas y procedimientos en la clínica Smile Cloud pueden ser fotografiados o grabados, y de que estas imágenes son datos personales sensibles por estar relacionadas con mi salud.",
                "Autorizo captar: {medios}. Y autorizo su uso únicamente para: {alcance}.",
                "El tratamiento de estas imágenes se hará conforme a la Ley 1581 de 2012 y a la política de tratamiento de datos de la clínica. Se almacenarán con medidas de seguridad y confidencialidad y no se entregarán a terceros sin mi autorización, salvo mandato legal.",
                "Esta autorización es voluntaria: puedo negarme sin que se afecte mi atención, y puedo revocarla en cualquier momento por escrito, en cuyo caso la clínica dejará de usar las imágenes para los fines que ya no autorice.",
                "Sé que puedo conocer, actualizar, rectificar y solicitar la supresión de mis datos e imágenes escribiendo a la clínica, y que esta autorización no genera ninguna contraprestación económica."
            ]
        },
        menores: {
            titulo: "Consentimiento informado para menores de edad",
            icono: "🧒",
            resumen: "Atención de pacientes menores, firma el representante legal",
            forzarRepresentante: true,
            campos: [
                { id: "fecha_nacimiento", etiqueta: "Fecha de nacimiento del menor", tipo: "date" },
                { id: "procedimiento", etiqueta: "Tratamiento o procedimiento autorizado", tipo: "text" },
                { id: "asentimiento", etiqueta: "Asentimiento del menor", tipo: "select", ancho: "completo", opciones: ["El menor fue informado y manifestó su asentimiento", "El menor no tiene edad o madurez suficiente para asentir"] }
            ],
            texto: [
                "El profesional {profesional} me explicó de forma clara el diagnóstico del menor y el tratamiento o procedimiento propuesto: {procedimiento}.",
                "Me informaron los beneficios esperados, los riesgos habituales y posibles complicaciones, las alternativas de tratamiento (incluida la de no tratar) y las consecuencias de no realizarlo.",
                "Informé con veracidad los antecedentes médicos, alergias, medicamentos y condiciones de salud del menor.",
                "Asentimiento del menor: {asentimiento}. Se le explicó la atención con palabras acordes a su edad y madurez, y se respetará su participación en lo posible.",
                "Cuando el procedimiento requiera anestesia, cirugía o uso de imagen, firmaré los consentimientos específicos correspondientes.",
                "Me comprometo a acompañar al menor cuando la clínica lo exija y a seguir las indicaciones dadas. Sé que puedo retirar esta autorización antes del procedimiento."
            ]
        }
    };

    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const valorDe = id => (document.getElementById(id)?.value || "").trim();
    const fechaLegible = iso => iso ? iso.split("-").reverse().join("/") : "";
    const blanco = v => (v && String(v).trim()) ? `<strong>${esc(v)}</strong>` : `<span class="cs-blanco"></span>`;

    let tipoConsentimiento = null;
    let modoFirma = "digital";

    // ---------- Firma en pantalla ----------
    function crearPad(canvas) {
        const ctx = canvas.getContext("2d");
        ctx.lineWidth = 2.4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#1c2b2d";
        let dibujando = false;
        let vacio = true;

        const punto = e => {
            const r = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - r.left) * canvas.width / r.width,
                y: (e.clientY - r.top) * canvas.height / r.height
            };
        };

        canvas.addEventListener("pointerdown", e => {
            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);
            dibujando = true;
            vacio = false;
            const p = punto(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + 0.1, p.y);
            ctx.stroke();
        });
        canvas.addEventListener("pointermove", e => {
            if (!dibujando) return;
            const p = punto(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        });
        ["pointerup", "pointercancel", "pointerleave"].forEach(ev =>
            canvas.addEventListener(ev, () => { dibujando = false; })
        );

        return {
            limpiar() { ctx.clearRect(0, 0, canvas.width, canvas.height); vacio = true; },
            estaVacio: () => vacio,
            imagen: () => canvas.toDataURL("image/png")
        };
    }

    const padFirmante = crearPad(document.getElementById("cs-canvas-firmante"));
    const padProfesional = crearPad(document.getElementById("cs-canvas-profesional"));
    document.querySelectorAll("[data-limpiar]").forEach(btn => {
        btn.addEventListener("click", () => {
            (btn.dataset.limpiar === "firmante" ? padFirmante : padProfesional).limpiar();
        });
    });

    // ---------- Lectura del formulario ----------
    function firmaOtraPersona() {
        const cfg = CONSENTIMIENTOS[tipoConsentimiento];
        return !!(cfg && cfg.forzarRepresentante) || document.getElementById("cs-otro-firmante").checked;
    }

    function leerDatos() {
        const cfg = CONSENTIMIENTOS[tipoConsentimiento];
        const otro = firmaOtraPersona();
        const extras = {};
        cfg.campos.forEach(c => {
            if (c.tipo === "checks") {
                extras[c.id] = Array.from(document.querySelectorAll(`#cs-x-${c.id} input:checked`)).map(i => i.value);
            } else {
                extras[c.id] = valorDe(`cs-x-${c.id}`);
            }
        });
        const decision = document.querySelector('input[name="cs-decision"]:checked');
        return {
            tipo: tipoConsentimiento,
            paciente: valorDe("cs-paciente-nombre"),
            documento: valorDe("cs-paciente-documento"),
            profesional: valorDe("cs-profesional"),
            fecha: valorDe("cs-fecha"),
            firmanteOtro: otro,
            firmante: otro ? valorDe("cs-firmante-nombre") : valorDe("cs-paciente-nombre"),
            firmanteDoc: otro ? valorDe("cs-firmante-doc") : valorDe("cs-paciente-documento"),
            parentesco: otro ? valorDe("cs-firmante-parentesco") : "",
            extras,
            decision: decision ? decision.value : ""
        };
    }

    // ---------- Documento (vista previa, impresión y registros guardados) ----------
    function htmlDocumento(d, firmas = {}, opciones = {}) {
        const cfg = CONSENTIMIENTOS[d.tipo];
        const logo = document.getElementById("cs-print-root")?.dataset.logo || "";

        const vars = { nombre: d.paciente, documento: d.documento, profesional: d.profesional };
        cfg.campos.forEach(c => {
            const v = d.extras[c.id];
            vars[c.id] = Array.isArray(v) ? v.join("; ") : (c.tipo === "date" ? fechaLegible(v) : v);
        });

        const calidad = d.firmanteOtro
            ? `en calidad de ${blanco(d.parentesco)} y representante legal del paciente ${blanco(d.paciente)} (documento de identidad No. ${blanco(d.documento)})`
            : "en calidad de paciente";

        const parrafos = cfg.texto
            .map(p => `<li>${p.replace(/\{(\w+)\}/g, (_, k) => blanco(vars[k]))}</li>`)
            .join("");

        const marca = v => d.decision === v ? "☒" : "☐";
        const rotuloFirmante = d.firmanteOtro ? "Representante legal" : "Paciente";

        const bloqueFirma = (rotulo, nombre, doc, img) => `
            <div class="cs-doc-firma">
                <div class="cs-doc-firma-area">${img ? `<img src="${img}" alt="Firma">` : ""}</div>
                <div class="cs-doc-firma-linea">Firma ${esc(rotulo)}</div>
                <div class="cs-doc-firma-dato">Nombre: ${blanco(nombre)}</div>
                <div class="cs-doc-firma-dato">Documento: ${blanco(doc)}</div>
            </div>`;

        const digital = !!firmas.firmante;
        const mostrarTestigo = !digital;

        return `
        <article class="cs-doc">
            <header class="cs-doc-cabecera">
                ${logo ? `<img src="${esc(logo)}" alt="Smile Cloud" class="cs-doc-logo">` : ""}
                <div>
                    <div class="cs-doc-clinica">Smile Cloud</div>
                    <h1>${esc(cfg.titulo)}</h1>
                </div>
            </header>
            <div class="cs-doc-datos">
                <div><span>Paciente</span>${blanco(d.paciente)}</div>
                <div><span>Documento</span>${blanco(d.documento)}</div>
                <div><span>Fecha</span>${blanco(fechaLegible(d.fecha))}</div>
                <div><span>Profesional</span>${blanco(d.profesional)}</div>
            </div>
            <p class="cs-doc-intro">Yo, ${blanco(d.firmante)}, identificado(a) con documento de identidad No. ${blanco(d.firmanteDoc)}, ${calidad}, declaro que:</p>
            <ol class="cs-doc-lista">${parrafos}</ol>
            <p class="cs-doc-decision"><strong>Decisión:</strong> &nbsp; ${marca("Autorizo")} Autorizo &nbsp;&nbsp; ${marca("No autorizo")} No autorizo</p>
            <div class="cs-doc-firmas">
                ${bloqueFirma(rotuloFirmante, d.firmante, d.firmanteDoc, firmas.firmante)}
                ${bloqueFirma("del profesional", d.profesional, "", firmas.profesional)}
                ${mostrarTestigo ? bloqueFirma("del testigo (opcional)", "", "", "") : ""}
            </div>
            ${opciones.pie ? `<p class="cs-doc-pie">${esc(opciones.pie)}</p>` : ""}
        </article>`;
    }

    function actualizarVistaPrevia() {
        if (!tipoConsentimiento) return;
        document.getElementById("cs-vista-previa").innerHTML = htmlDocumento(leerDatos());
    }

    // ---------- Impresión ----------
        // ---------- Ventana modal ----------
    const modalFondo = document.createElement("div");
    modalFondo.className = "cs-modal-fondo";
    modalFondo.hidden = true;
    modalFondo.innerHTML = `
        <div class="cs-modal" role="dialog" aria-modal="true" aria-labelledby="cs-modal-titulo">
            <div class="cs-modal-cabecera">
                <h3 id="cs-modal-titulo"></h3>
                <button type="button" class="cs-modal-x" aria-label="Cerrar">&times;</button>
            </div>
            <div class="cs-modal-cuerpo"></div>
            <div class="cs-modal-pie"></div>
        </div>`;
    document.body.appendChild(modalFondo);

    function cerrarModal() {
        modalFondo.hidden = true;
        modalFondo.querySelector(".cs-modal-cuerpo").innerHTML = "";
    }

    function abrirModal({ titulo, html = "", ancho = false, acciones = [] }) {
        modalFondo.querySelector(".cs-modal").classList.toggle("cs-modal-ancho", ancho);
        modalFondo.querySelector("#cs-modal-titulo").textContent = titulo;
        modalFondo.querySelector(".cs-modal-cuerpo").innerHTML = html;
        const pie = modalFondo.querySelector(".cs-modal-pie");
        pie.innerHTML = "";
        acciones.forEach(a => {
            const b = document.createElement("button");
            b.type = "button";
            b.className = `hc-btn ${a.clase || "secondary"}`;
            b.textContent = a.texto;
            b.addEventListener("click", () => {
                if (a.cerrar !== false) cerrarModal();
                if (a.onClick) a.onClick();
            });
            pie.appendChild(b);
        });
        modalFondo.hidden = false;
        pie.querySelector("button:last-child")?.focus();
    }

    modalFondo.addEventListener("click", e => { if (e.target === modalFondo) cerrarModal(); });
    modalFondo.querySelector(".cs-modal-x").addEventListener("click", cerrarModal);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !modalFondo.hidden) cerrarModal(); });

    // ---------- Impresión (en un iframe oculto, no depende del resto de la página) ----------
    const ESTILO_DOCUMENTO = `
        @page { margin: 16mm; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; }
        .cs-doc{font-family:Georgia,"Times New Roman",serif;color:#1c2b2d;line-height:1.55;font-size:12.5pt}
        .cs-doc-cabecera{display:flex;align-items:center;gap:16px;border-bottom:2px solid #3d7b7e;padding-bottom:12px;margin-bottom:14px}
        .cs-doc-logo{height:52px;width:auto}
        .cs-doc-clinica{font-size:13px;color:#587074}
        .cs-doc-cabecera h1{text-align:left;font-size:20px;margin:2px 0 0;color:#1c2b2d}
        .cs-doc-datos{display:grid;grid-template-columns:repeat(2,1fr);gap:6px 24px;margin-bottom:14px}
        .cs-doc-datos span{display:inline-block;min-width:88px;color:#587074}
        .cs-doc-intro{margin:0 0 8px}
        .cs-doc-lista{padding-left:22px;margin:0 0 12px}
        .cs-doc-lista li{margin-bottom:8px;text-align:justify}
        .cs-doc-decision{margin:12px 0 4px}
        .cs-blanco{display:inline-block;min-width:130px;border-bottom:1px solid #1c2b2d;height:1em;vertical-align:baseline}
        .cs-doc-firmas{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:26px;margin-top:22px;break-inside:avoid;page-break-inside:avoid}
        .cs-doc-firma{position:relative;break-inside:avoid}
        .cs-doc-firma-area{height:74px;display:flex;align-items:flex-end;justify-content:center}
        .cs-doc-firma-area img{max-height:70px;max-width:100%}
        .cs-doc-firma-linea{border-top:1px solid #1c2b2d;padding-top:4px;font-size:12.5px;color:#587074}
        .cs-doc-firma-dato{font-size:12.5px;margin-top:5px}
        .cs-doc-pie{margin-top:16px;font-size:12px;color:#587074}
    `;


    function imprimirHTML(html) {
        const iframe = document.createElement("iframe");
        iframe.setAttribute("aria-hidden", "true");
        iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
        document.body.appendChild(iframe);

        const ventana = iframe.contentWindow;
        const doc = ventana.document;
        doc.open();
        doc.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Consentimiento informado</title><style>${ESTILO_DOCUMENTO}</style></head><body>${html}</body></html>`);
        doc.close();

        const quitar = () => setTimeout(() => iframe.remove(), 500);
        const lanzar = () => {
            ventana.onafterprint = quitar;
            ventana.focus();
            ventana.print();
        };

        // Espera a que carguen las imágenes (logo y firmas) antes de imprimir
        const imagenes = Array.from(doc.images);
        const pendientes = imagenes.filter(i => !i.complete);
        if (!pendientes.length) { lanzar(); return; }
        let listo = false;
        const seguir = () => { if (!listo) { listo = true; lanzar(); } };
        let faltan = pendientes.length;
        pendientes.forEach(i => {
            i.addEventListener("load", () => { if (--faltan === 0) seguir(); });
            i.addEventListener("error", () => { if (--faltan === 0) seguir(); });
        });
        setTimeout(seguir, 2000);
    }

    // ---------- Almacenamiento (igual que la historia: en este equipo) ----------
    const claveConsentimientos = () => pacienteActual ? `smilecloud_consentimientos_${pacienteActual.id_paciente ?? pacienteActual.id}` : null;

    function leerRegistros() {
        const key = claveConsentimientos();
        if (!key) return [];
        try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; }
    }

    function guardarRegistro(registro) {
        const key = claveConsentimientos();
        const lista = leerRegistros();
        lista.unshift(registro);
        try {
            localStorage.setItem(key, JSON.stringify(lista));
            return true;
        } catch {
            return false;
        }
    }

    // NUEVO: ahora usa SweetAlert2 (notificación si sale bien, alerta si falla)
    function mostrarMensaje(texto, ok = true) {
        const el = document.getElementById("cs-mensaje");
        if (el) { el.textContent = ""; el.className = ""; }
        if (!texto) { return; }
        if (ok) {
            scToast(texto, "success");
        } else {
            scAviso("Revisa el consentimiento", texto, "error");
        }
    }

        function pintarHistorial() {
        const cont = document.getElementById("cs-historial");
        const lista = leerRegistros();
        if (!pacienteActual || !lista.length) {
            cont.innerHTML = `<p class="hc-empty">Aún no hay consentimientos registrados.</p>`;
            return;
        }
        cont.innerHTML = "";
        lista.forEach(r => {
            const cfg = CONSENTIMIENTOS[r.datos.tipo];
            const cuando = new Date(r.fechaHora).toLocaleString("es-CO");
            const pie = r.modo === "digital"
                ? `Firmado digitalmente el ${cuando}.`
                : `Registrado como firmado en físico el ${cuando}.`;

            const item = document.createElement("article");
            item.className = "cs-registro";
            item.innerHTML = `
                <div class="cs-registro-info">
                    <strong>${cfg.icono} ${esc(cfg.titulo)}</strong>
                    <span>${esc(cuando)} · ${r.modo === "digital" ? "Firma digital" : "Firmado en físico"} · ${esc(r.datos.decision || "Según documento físico")}</span>
                </div>
                <div class="cs-registro-botones">
                    <button type="button" class="hc-btn secondary small" data-accion="ver">Ver</button>
                    <button type="button" class="hc-btn outline small" data-accion="imprimir">Imprimir</button>
                </div>`;

            item.querySelector('[data-accion="ver"]').addEventListener("click", () => {
                const documento = htmlDocumento(r.datos, r.firmas, { pie });
                abrirModal({
                    titulo: cfg.titulo,
                    html: documento,
                    ancho: true,
                    acciones: [
                        { texto: "Cerrar", clase: "secondary" },
                        { texto: "Imprimir", clase: "primary", cerrar: false, onClick: () => imprimirHTML(documento) }
                    ]
                });
            });

            item.querySelector('[data-accion="imprimir"]').addEventListener("click", () => {
                imprimirHTML(htmlDocumento(r.datos, r.firmas, { pie }));
            });

            cont.appendChild(item);
        });
    }

    // ---------- Interfaz ----------
    function dibujarCampos(cfg) {
        const cont = document.getElementById("cs-extras");
        cont.innerHTML = "";
        cfg.campos.forEach(c => {
            const bloque = document.createElement("div");
            if (c.ancho === "completo" || c.tipo === "checks") bloque.className = "hc-full";
            const etiqueta = document.createElement("label");
            etiqueta.textContent = c.etiqueta;
            bloque.appendChild(etiqueta);

            if (c.tipo === "select") {
                const sel = document.createElement("select");
                sel.id = `cs-x-${c.id}`;
                c.opciones.forEach(o => sel.add(new Option(o, o)));
                etiqueta.htmlFor = sel.id;
                bloque.appendChild(sel);
            } else if (c.tipo === "checks") {
                const grupo = document.createElement("div");
                grupo.id = `cs-x-${c.id}`;
                grupo.className = "cs-checks";
                c.opciones.forEach(o => {
                    const l = document.createElement("label");
                    l.className = "cs-check";
                    l.innerHTML = `<input type="checkbox" value="${esc(o)}"><span>${esc(o)}</span>`;
                    grupo.appendChild(l);
                });
                bloque.appendChild(grupo);
            } else {
                const inp = document.createElement("input");
                inp.type = c.tipo === "date" ? "date" : "text";
                inp.id = `cs-x-${c.id}`;
                etiqueta.htmlFor = inp.id;
                bloque.appendChild(inp);
            }
            cont.appendChild(bloque);
        });
    }

    function aplicarFirmante() {
        const otro = firmaOtraPersona();
        const check = document.getElementById("cs-otro-firmante");
        const forzado = !!CONSENTIMIENTOS[tipoConsentimiento]?.forzarRepresentante;
        if (forzado) check.checked = true;
        check.disabled = forzado;
        document.getElementById("cs-firmante-datos").hidden = !otro;
        document.getElementById("cs-firma-firmante-label").textContent = otro ? "Firma del representante legal" : "Firma del paciente";
    }

    function limpiarFormulario() {
        padFirmante.limpiar();
        padProfesional.limpiar();
        document.getElementById("cs-acepta").checked = false;
        document.querySelectorAll('input[name="cs-decision"]').forEach(r => { r.checked = false; });
        document.getElementById("cs-otro-firmante").checked = false;
        ["cs-firmante-nombre", "cs-firmante-doc", "cs-firmante-parentesco"].forEach(id => { document.getElementById(id).value = ""; });
    }

    function elegirTipo(tipo) {
        if (!pacienteActual) {
            mostrarMensaje("", true);
            document.getElementById("cs-aviso").hidden = false;
            // NUEVO: aviso con SweetAlert2 (antes era la ventana propia)
            scAviso(
                "Falta el paciente",
                "Primero busca y selecciona un paciente en la pestaña Historial.",
                "info"
            );
            return;
        }
        tipoConsentimiento = tipo;
        const cfg = CONSENTIMIENTOS[tipo];
        if (selectorConsentimiento) selectorConsentimiento.value = tipo;
        limpiarFormulario();
        dibujarCampos(cfg);

        document.getElementById("cs-titulo").textContent = cfg.titulo;
        document.getElementById("cs-paciente-nombre").value = `${pacienteActual.nombre ?? ""} ${pacienteActual.apellido ?? ""}`.trim();
        document.getElementById("cs-paciente-documento").value = pacienteActual.numero_documento || "";
        document.getElementById("cs-profesional").value = pacienteActual.especialista || "";
        document.getElementById("cs-fecha").value = new Date().toISOString().slice(0, 10);
        mostrarMensaje("");

        aplicarFirmante();
        document.getElementById("cs-formulario").hidden = false;
        actualizarVistaPrevia();
        document.getElementById("cs-formulario").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function cambiarModo(modo) {
        modoFirma = modo;
        document.querySelectorAll(".cs-modo").forEach(b => b.classList.toggle("active", b.dataset.modo === modo));
        document.getElementById("cs-pane-digital").hidden = modo !== "digital";
        document.getElementById("cs-pane-presencial").hidden = modo !== "presencial";
    }

    // Lista desplegable de consentimientos. Al seleccionar uno se abre
    // inmediatamente el formulario para diligenciarlo en línea.
    const selectorConsentimiento = document.getElementById("cs-selector");
    Object.entries(CONSENTIMIENTOS).forEach(([tipo, cfg]) => {
        const option = new Option(`${cfg.icono} ${cfg.titulo}`, tipo);
        option.title = cfg.resumen;
        selectorConsentimiento.appendChild(option);
    });
    selectorConsentimiento.addEventListener("change", () => {
        if (selectorConsentimiento.value) elegirTipo(selectorConsentimiento.value);
    });

    document.querySelectorAll(".cs-modo").forEach(b => b.addEventListener("click", () => cambiarModo(b.dataset.modo)));

    const formularioCs = document.getElementById("cs-formulario");
    formularioCs.addEventListener("input", actualizarVistaPrevia);
    formularioCs.addEventListener("change", () => { aplicarFirmante(); actualizarVistaPrevia(); });

    // Guardar firma digital
    document.getElementById("cs-guardar-digital").addEventListener("click", () => {
        const d = leerDatos();
        if (!d.decision) return mostrarMensaje("Seleccione la decisión del paciente: Autorizo o No autorizo.", false);
        if (!d.firmante) return mostrarMensaje("Escriba el nombre de quien firma.", false);
        if (!document.getElementById("cs-acepta").checked) return mostrarMensaje("Marque que el firmante leyó y comprendió el consentimiento.", false);
        if (padFirmante.estaVacio()) return mostrarMensaje("Falta la firma en pantalla.", false);

        const registro = {
            fechaHora: new Date().toISOString(),
            modo: "digital",
            datos: d,
            firmas: {
                firmante: padFirmante.imagen(),
                profesional: padProfesional.estaVacio() ? "" : padProfesional.imagen()
            }
        };
        if (!guardarRegistro(registro)) {
            return mostrarMensaje("No se pudo guardar: el almacenamiento del navegador está lleno.", false);
        }
        padFirmante.limpiar();
        padProfesional.limpiar();
        document.getElementById("cs-acepta").checked = false;
        mostrarMensaje("Consentimiento firmado y guardado correctamente en este equipo.");
        pintarHistorial();
    });

    // Firma presencial
        // Firma presencial
    document.getElementById("cs-imprimir").addEventListener("click", () => {
        if (!tipoConsentimiento) return;
        imprimirHTML(htmlDocumento(leerDatos()));
    });

    // NUEVO: la confirmación ahora usa SweetAlert2 (antes era la ventana propia)
    document.getElementById("cs-registrar-fisico").addEventListener("click", () => {
        if (!tipoConsentimiento) return;
        const d = leerDatos();

        scConfirmar({
            titulo: "¿Confirmar firma presencial?",
            texto: CONSENTIMIENTOS[tipoConsentimiento].titulo +
                   " · Paciente: " + d.paciente +
                   ". ¿El formato impreso ya fue firmado por el paciente?",
            ok: "Sí, registrar",
            cancelar: "Cancelar"
        }).then(acepto => {
            if (!acepto) { return; }

            const registro = { fechaHora: new Date().toISOString(), modo: "presencial", datos: d, firmas: {} };
            if (!guardarRegistro(registro)) {
                return mostrarMensaje("No se pudo guardar: el almacenamiento del navegador está lleno.", false);
            }
            mostrarMensaje("Consentimiento registrado como firmado en físico.");
            pintarHistorial();
        });
    });

    // Se llama cada vez que se carga un paciente
    function refrescarConsentimientos() {
        document.getElementById("cs-aviso").hidden = !!pacienteActual;
        formularioCs.hidden = true;
        tipoConsentimiento = null;
        const selector = document.getElementById("cs-selector");
        if (selector) selector.value = "";
        pintarHistorial();
    }
    refrescarConsentimientos();
    cambiarModo("digital");

    // =====================================================================
    // CONEXIÓN CON LA BÚSQUEDA NUEVA
    // Convierte el paciente de la página nueva al formato que usa el
    // código de consentimientos (nombre + apellido, numero_documento, id...).
    // =====================================================================
    document.addEventListener("hc:paciente", e => {
        const p = e.detail;
        if (!p) {
            pacienteActual = null;
        } else {
            const crudo = (p._raw && typeof p._raw === "object" && !Array.isArray(p._raw)) ? p._raw : {};
            pacienteActual = Object.assign({}, crudo, {
                nombre: p.nombre,                 // ya viene completo
                apellido: "",
                numero_documento: p.documento,
                documento: p.documento,
                telefono: p.telefono,
                correo: p.correo,
                eps: p.eps,
                id_paciente: crudo.id_paciente ?? crudo.id ?? p.documento,
                especialista: crudo.especialista || (window.HC_CONFIG && window.HC_CONFIG.usuario) || ""
            });
        }
        refrescarConsentimientos();
    });
});