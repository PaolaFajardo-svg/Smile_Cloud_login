"""
============================================================
INTEGRACIÓN CON GOOGLE CALENDAR - SMILE CLOUD
============================================================

Este módulo refleja en un Google Calendar las citas que están
registradas en el sistema (tabla `cita` / `consulta_clinica`
de la base de datos Smile_Cloud).

Funcionamiento:
  * Cada cita de la BD se convierte en UN evento de Google Calendar.
  * El id del evento es fijo: "smilecloud" + id_cita (ej. smilecloud12).
    Gracias a eso nunca se duplican eventos: si la cita ya existe en
    Google se actualiza, y si no existe se crea.
  * Estados:
        Pendiente / Programada / Confirmada / Finalizada -> evento
        (con un color distinto según el estado)
        Cancelada                                         -> se elimina
        el evento de la agenda.

Autenticación: cuenta de servicio de Google (archivo JSON) a la que se
le comparte el calendario con permiso "Realizar cambios en eventos".

Configuración (variables de entorno, o editar los valores por defecto):
    GOOGLE_CALENDAR_ID        id del calendario (ej. xxxx@group.calendar.google.com)
    GOOGLE_CREDENTIALS_FILE   ruta del JSON de la cuenta de servicio
    GOOGLE_CALENDAR_TZ        zona horaria (por defecto America/Bogota)
    DURACION_CITA_MINUTOS     duración de cada cita (por defecto 30)
"""

import os
from datetime import datetime, timedelta
from urllib.parse import quote

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ------------------------------------------------------------
# CONFIGURACIÓN
# ------------------------------------------------------------

GOOGLE_CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "c1f6bf72b7142999def50ce362f19388743c106796c51b65388a05e007bf0357@group.calendar.google.com")
GOOGLE_CREDENTIALS_FILE = os.environ.get(
    "GOOGLE_CREDENTIALS_FILE",
    os.path.join(BASE_DIR, "credenciales_google.json"),
)

ZONA_HORARIA = os.environ.get("GOOGLE_CALENDAR_TZ", "America/Bogota")

DURACION_CITA_MINUTOS = int(os.environ.get("DURACION_CITA_MINUTOS", "30"))

ALCANCE = ["https://www.googleapis.com/auth/calendar"]

API_EVENTOS = "https://www.googleapis.com/calendar/v3/calendars/{cal}/events"

# Color del evento según el estado de la cita (colorId de Google Calendar)
COLOR_POR_ESTADO = {
    "Pendiente": "5",     # amarillo
    "Programada": "9",    # azul
    "Confirmada": "10",   # verde
    "Finalizada": "8",    # gris
}

_sesion = None


# ------------------------------------------------------------
# UTILIDADES
# ------------------------------------------------------------

def google_configurado():
    """True si hay id de calendario y archivo de credenciales."""
    return bool(GOOGLE_CALENDAR_ID) and os.path.isfile(GOOGLE_CREDENTIALS_FILE)


def url_embed_calendario():
    """
    URL para incrustar (iframe) el Google Calendar en la página de citas.
    Devuelve '' si el calendario no está configurado.
    """
    if not GOOGLE_CALENDAR_ID:
        return ""
    return (
        "https://calendar.google.com/calendar/embed"
        f"?src={quote(GOOGLE_CALENDAR_ID)}"
        f"&ctz={quote(ZONA_HORARIA)}"
        "&mode=WEEK&showTitle=0&showPrint=0&showTz=0&hl=es"
    )


def id_evento(id_cita):
    """Id fijo del evento en Google (solo letras a-v y números)."""
    return f"smilecloud{int(id_cita)}"


def _obtener_sesion():
    """Crea (una sola vez) la sesión autenticada con la cuenta de servicio."""
    global _sesion
    if _sesion is None:
        from google.oauth2 import service_account
        from google.auth.transport.requests import AuthorizedSession

        credenciales = service_account.Credentials.from_service_account_file(
            GOOGLE_CREDENTIALS_FILE, scopes=ALCANCE
        )
        _sesion = AuthorizedSession(credenciales)
    return _sesion


def _a_texto_fecha(valor):
    """Convierte date/datetime/str a 'YYYY-MM-DD'."""
    if hasattr(valor, "strftime"):
        return valor.strftime("%Y-%m-%d")
    return str(valor)[:10]


def _a_texto_hora(valor):
    """Convierte time/timedelta/str a 'HH:MM'."""
    if hasattr(valor, "strftime"):
        return valor.strftime("%H:%M")
    if isinstance(valor, timedelta):
        total = int(valor.total_seconds())
        return f"{total // 3600:02d}:{(total % 3600) // 60:02d}"
    return str(valor)[:5]


def construir_evento(cita):
    """
    Convierte una cita (dict devuelto por GET /consulta_clinica) en el
    cuerpo de un evento de Google Calendar.
    """
    fecha = _a_texto_fecha(cita["fecha"])
    hora = _a_texto_hora(cita["hora"])

    inicio = datetime.strptime(f"{fecha} {hora}", "%Y-%m-%d %H:%M")
    fin = inicio + timedelta(minutes=DURACION_CITA_MINUTOS)

    estado = cita.get("estado") or "Pendiente"
    paciente = cita.get("paciente") or "Paciente"
    especialista = cita.get("especialista") or ""
    consultorio = cita.get("consultorio") or ""
    motivo = cita.get("motivo") or ""

    descripcion = (
        f"Paciente: {paciente}\n"
        f"Especialista: {especialista}\n"
        f"Consultorio: {consultorio}\n"
        f"Motivo: {motivo}\n"
        f"Estado: {estado}\n"
        f"Cita #{cita.get('id_cita')} - Smile Cloud"
    )

    return {
        "id": id_evento(cita["id_cita"]),
        "status": "confirmed",
        "summary": f"{paciente} - {especialista}".strip(" -"),
        "description": descripcion,
        "location": consultorio,
        "colorId": COLOR_POR_ESTADO.get(estado, "5"),
        "start": {
            "dateTime": inicio.strftime("%Y-%m-%dT%H:%M:00"),
            "timeZone": ZONA_HORARIA,
        },
        "end": {
            "dateTime": fin.strftime("%Y-%m-%dT%H:%M:00"),
            "timeZone": ZONA_HORARIA,
        },
    }


# ------------------------------------------------------------
# OPERACIONES CONTRA GOOGLE CALENDAR
# ------------------------------------------------------------

def eliminar_evento(id_cita):
    """Elimina de Google Calendar el evento de una cita (cancelada)."""
    sesion = _obtener_sesion()
    url = API_EVENTOS.format(cal=quote(GOOGLE_CALENDAR_ID, safe="")) + "/" + id_evento(id_cita)
    r = sesion.delete(url, timeout=15)
    # 404/410 = el evento ya no existía: no es un error
    if r.status_code not in (200, 204, 404, 410):
        r.raise_for_status()
    return "eliminada"


def sincronizar_cita(cita):
    """
    Crea o actualiza en Google Calendar el evento de UNA cita.
    Si la cita está Cancelada, borra el evento.
    Devuelve 'creada', 'actualizada' o 'eliminada'.
    """
    if (cita.get("estado") or "") == "Cancelada":
        return eliminar_evento(cita["id_cita"])

    sesion = _obtener_sesion()
    evento = construir_evento(cita)
    url_base = API_EVENTOS.format(cal=quote(GOOGLE_CALENDAR_ID, safe=""))

    # 1) Intentar actualizar (también "resucita" eventos borrados antes,
    #    por ejemplo si una cita se reagenda tras cancelarse)
    r = sesion.put(f"{url_base}/{evento['id']}", json=evento, timeout=15)
    if r.status_code == 200:
        return "actualizada"
    if r.status_code != 404:
        r.raise_for_status()

    # 2) No existe todavía -> crear
    r = sesion.post(url_base, json=evento, timeout=15)
    r.raise_for_status()
    return "creada"


def sincronizar_todas(citas):
    """
    Sincroniza una lista de citas. Devuelve un resumen:
    {'creadas': n, 'actualizadas': n, 'eliminadas': n, 'errores': n}
    """
    resumen = {"creadas": 0, "actualizadas": 0, "eliminadas": 0, "errores": 0}
    for cita in citas:
        try:
            accion = sincronizar_cita(cita)
            resumen[{"creada": "creadas",
                     "actualizada": "actualizadas",
                     "eliminada": "eliminadas"}[accion]] += 1
        except Exception:
            resumen["errores"] += 1
    return resumen
