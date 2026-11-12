# NUEVO: se agregó "flash" al import
from flask import Flask, render_template, request, redirect, url_for, send_file, session, flash
from io import BytesIO
from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import (SimpleDocTemplate,Table,TableStyle,Paragraph,Spacer)
from reportlab.lib.styles import getSampleStyleSheet
import pymysql
import bcrypt
import requests
from app.routes import paciente
from app.database import crear_conexion
from app import google_calendar
import time
from datetime import datetime
import math

# ============================================================
# CONFIGURACIÓN DE FLASK
# ============================================================

app = Flask(__name__)

app.secret_key = 'smile_cloud_secreto_2026'


@app.after_request
def evitar_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ============================================================
# CONTROL DE INTENTOS DE INICIO DE SESIÓN
# ============================================================
MAX_INTENTOS = 3
TIEMPO_BLOQUEO = 60

# ============================================================
# LOGIN
# ============================================================
@app.route('/', methods=['GET', 'POST'])
def login():

    if request.method == 'POST':
        correo = request.form['correo'].strip()
        password = request.form['password']
        conexion = None

        try:
            conexion = crear_conexion()

            # La transacción protege el contador frente
            # a intentos simultáneos del mismo correo.
            conexion.begin()

            with conexion.cursor() as cursor:

                # Crear el registro si todavía no existe.
                cursor.execute("""
                    INSERT IGNORE INTO intentos_login
                        (identificador, intentos_fallidos, bloqueado_hasta)
                    VALUES (%s, 0, NULL)
                """, (correo,))

                # Bloquear la fila mientras procesamos el intento.
                cursor.execute("""
                    SELECT intentos_fallidos, bloqueado_hasta
                    FROM intentos_login
                    WHERE identificador = %s
                    FOR UPDATE
                """, (correo,))

                registro_intentos = cursor.fetchone()

                # Comprobar bloqueo temporal.
                cursor.execute("""
                    SELECT GREATEST(
                        0,
                        TIMESTAMPDIFF(SECOND, NOW(), %s) + 1
                    ) AS segundos
                """, (registro_intentos['bloqueado_hasta'],))

               
                tiempo_restante = cursor.fetchone()['segundos']

                if tiempo_restante is None:
                    tiempo_restante = 0

                if tiempo_restante > 0:

                    conexion.commit()

                    return render_template(
                        'login.html',
                        error='Demasiados intentos incorrectos. Espera a que termine el bloqueo.',
                        tiempo_restante=tiempo_restante
                    )
               
                # ============================================================
                # Reiniciar el contador si el bloqueo terminó.
                # ============================================================

                if registro_intentos['bloqueado_hasta'] is not None:
                    cursor.execute("""
                        UPDATE intentos_login
                        SET intentos_fallidos = 0,
                            bloqueado_hasta = NULL
                        WHERE identificador = %s
                    """, (correo,))

                    registro_intentos['intentos_fallidos'] = 0

                # ============================================================
                # Buscar usuario y rol.
                # ============================================================

                cursor.execute("""
                    SELECT
                        u.id_usuario,
                        u.usuario,
                        u.contrasena,
                        u.correo,
                        u.estado,
                        r.nombre
                    FROM usuario u
                    INNER JOIN rol r
                        ON u.id_rol = r.id_rol
                    WHERE u.correo = %s
                """, (correo,))

                usuario = cursor.fetchone()

                # Comprobar credenciales.
                contraseña_correcta = False

                if usuario and usuario['estado'].lower() == 'activo':

                    contraseña_guardada = usuario['contrasena']

                    if isinstance(contraseña_guardada, str):
                        contraseña_guardada = contraseña_guardada.encode('utf-8')

                    contraseña_correcta = bcrypt.checkpw(
                        password.encode('utf-8'),
                        contraseña_guardada
                    )

                # ============================================================
                # Inicio de sesión correcto.
                # ============================================================

                if contraseña_correcta:

                    cursor.execute("""
                        UPDATE intentos_login
                        SET intentos_fallidos = 0,
                            bloqueado_hasta = NULL
                        WHERE identificador = %s
                    """, (correo,))

                    conexion.commit()

                    session['correo'] = usuario['correo']
                    session['usuario'] = usuario['usuario']
                    session['rol'] = usuario['nombre']
                    session['letra'] = usuario['nombre'][0].upper()

                    return redirect(url_for('home'))
               
                # ============================================================
                # Conservar el mensaje para usuarios inactivos.
                # ============================================================

                if usuario and usuario['estado'].lower() != 'activo':
                    conexion.commit()

                    return render_template(
                        'login.html',
                        error='El usuario se encuentra inactivo'
                    )

                # ============================================================
                # Registrar intento incorrecto, incluyendo los correos que no existen.
                # ============================================================

                nuevos_intentos = (
                    registro_intentos['intentos_fallidos'] + 1
                )

                if nuevos_intentos >= MAX_INTENTOS:

                    cursor.execute("""
                        UPDATE intentos_login
                        SET intentos_fallidos = %s,
                            bloqueado_hasta = DATE_ADD(
                                NOW(), INTERVAL %s SECOND
                            )
                        WHERE identificador = %s
                    """, (
                        MAX_INTENTOS,
                        TIEMPO_BLOQUEO,
                        correo
                    ))

                    conexion.commit()

                    return render_template(
                        'login.html',
                        error='Has alcanzado el máximo de intentos. Espera 60 segundos.',
                        tiempo_restante=TIEMPO_BLOQUEO
                    )

                cursor.execute("""
                    UPDATE intentos_login
                    SET intentos_fallidos = %s,
                        bloqueado_hasta = NULL
                    WHERE identificador = %s
                """, (nuevos_intentos, correo))

                conexion.commit()

               
                intentos_restantes = MAX_INTENTOS - nuevos_intentos

                if intentos_restantes == 1:
                    mensaje_intentos = "Te queda 1 intento."
                else:
                    mensaje_intentos = f"Te quedan {intentos_restantes} intentos."

                return render_template(
                    'login.html',
                    error=(
                        'Correo o contraseña incorrectos. '
                        + mensaje_intentos
                    )
                )


        except pymysql.Error:
            if conexion:
                conexion.rollback()

            app.logger.exception(
                'Error de base de datos durante el inicio de sesión'
            )

            return render_template(
                'login.html',
                error='No se pudo iniciar sesión. Intenta nuevamente.'
            )

        finally:
            if conexion:
                conexion.close()

    return render_template('login.html')



# ============================================================
# RECUPERACIÓN DE CONTRASEÑA
# ============================================================

@app.route('/RecupContra')
def mensaje():

    return render_template('mensContraseña.html')


# ============================================================
# CERRAR SESIÓN
# ============================================================

@app.route('/cerrar_sesion')
def cerrar_sesion():

    session.clear()

    return redirect(url_for('login'))


# ============================================================
# CONFIGURACIÓN
# ============================================================

@app.route('/configuracion')
def configuracion():

    if 'correo' not in session:
        return redirect(url_for('login'))

    return render_template(
        'configuracion.html',
        rol=session.get('rol'),
        correo=session.get('correo')
    )


# ============================================================
# HOME
# ============================================================

@app.route('/home')
def home():

    if 'correo' not in session:
        return redirect(url_for('login'))

    respuesta = requests.get(
        "http://127.0.0.1:8000/pacientes"
    )

    pacientes = respuesta.json()

    return render_template(
        'home.html',
        pacientes=pacientes
    )
# ============================================================
# odontograma
# ============================================================

@app.route('/odontograma')
def odontograma():
    # Si no ha iniciado sesión
    if 'usuario' not in session:
        return redirect(url_for('login'))   # cambia 'login' por tu ruta de inicio de sesión

    # Si no es Odontólogo
    if session.get('rol') != 'Odontologo':
        # NUEVO: categoría 'error' para que se muestre como alerta de error
        flash('No tienes permiso para acceder al odontograma.', 'error')
        return redirect('/home')

    return render_template('odontograma.html')

   
# ============================================================
# PACIENTES
# ============================================================

@app.route('/pacientes')
def pacientes_view():

    if 'correo' not in session:
        return redirect(url_for('login'))

    respuesta = requests.get(
        "http://127.0.0.1:8000/pacientes"
    )

    pacientes = respuesta.json()

    return render_template(
        'pacientes.html',
        pacientes=pacientes
    )


# ============================================================
# MOSTRAR FORMULARIO DE CREAR PACIENTE
# ============================================================

@app.route('/crear_paciente', methods=['GET'])
def mostrar_formulario_paciente():

    if 'correo' not in session:
        return redirect(url_for('login'))

    return render_template(
        'crear_paciente.html'
    )


# ============================================================
# CREAR PACIENTE
# ============================================================

@app.route('/crear_paciente', methods=['POST'])
def crear_paciente():

    if 'correo' not in session:
        return redirect(url_for('login'))

    datos = {
        "tipo_documento": request.form['tipo_documento'],
        "numero_documento": request.form['numero_documento'],
        "nombre": request.form['nombre'],
        "apellido": request.form['apellido'],
        "fecha_nacimiento": request.form['fecha_nacimiento'] or None,
        "sexo": request.form['sexo'] or None,
        "telefono": request.form['telefono'] or None,
        "correo": request.form['correo'] or None,
        "direccion": request.form['direccion'] or None,
        "eps": request.form['eps'] or None,
        "estado": "Activo"
    }

    respuesta = requests.post(
        "http://127.0.0.1:8000/pacientes",
        json=datos
    )

    if respuesta.status_code == 200:
        return redirect(url_for('pacientes_view'))

    return respuesta.text, respuesta.status_code

# ============================================================
# ELIMINAR / INACTIVAR PACIENTE
# ============================================================

@app.route('/eliminar/<int:id>')
def eliminar(id):

    if 'correo' not in session:
        return redirect(url_for('login'))

    requests.delete(
        f"http://127.0.0.1:8000/pacientes/{id}"
    )

    return redirect(url_for('pacientes_view'))


# ============================================================
# EDITAR PACIENTE
# ============================================================

@app.route('/editar/<int:id>')
def editar(id):

    if 'correo' not in session:
        return redirect(url_for('login'))

    respuesta = requests.get(
        "http://127.0.0.1:8000/pacientes"
    )

    pacientes = respuesta.json()

    paciente = next(
        (
            p for p in pacientes
            if p['id_paciente'] == id
        ),
        None
    )

    return render_template(
        'editar_paciente.html',
        paciente=paciente
    )


# ============================================================
# ACTUALIZAR PACIENTE
# ============================================================

@app.route('/actualizar/<int:id>', methods=['POST'])
def actualizar(id):

    if 'correo' not in session:
        return redirect(url_for('login'))

    respuesta_pacientes = requests.get(
        "http://127.0.0.1:8000/pacientes"
    )

    pacientes = respuesta_pacientes.json()

    paciente_actual = next(
        (
            p for p in pacientes
            if p['id_paciente'] == id
        ),
        None
    )

    if not paciente_actual:
        return redirect(url_for('pacientes_view'))

    datos = {
        "tipo_documento": request.form['tipo_documento'],
        "numero_documento": request.form['numero_documento'],
        "nombre": request.form['nombre'],
        "apellido": request.form['apellido'],
        "fecha_nacimiento": request.form['fecha_nacimiento'],
        "sexo": request.form['sexo'],
        "telefono": request.form['telefono'],
        "correo": request.form['correo'],
        "direccion": request.form['direccion'],
        "eps": request.form['eps'],

        "estado": paciente_actual['estado']
    }

    requests.put(
        f"http://127.0.0.1:8000/pacientes/{id}",
        json=datos
    )

    return redirect(url_for('pacientes_view'))


# ============================================================
# USUARIOS
# ============================================================

API_USUARIOS = "http://127.0.0.1:8000/usuario"


def _solo_administrador():
    """Devuelve una redirección si no hay sesión o no es administrador."""

    if 'correo' not in session:
        return redirect(url_for('login'))

    if session.get('rol') != 'Administrador':
        return redirect(url_for('home'))

    return None


def _obtener_json(url, por_defecto):
    """Consulta un endpoint de FastAPI y devuelve su JSON (o el valor por defecto)."""

    try:
        respuesta = requests.get(url, timeout=10)
        return respuesta.json() if respuesta.ok else por_defecto
    except requests.RequestException:
        return por_defecto


def _mensaje_error_usuario(respuesta, por_defecto):
    """Convierte el error de FastAPI en un mensaje entendible."""

    try:
        detalle = respuesta.json().get("detail", por_defecto)
    except ValueError:
        return por_defecto

    if isinstance(detalle, list):
        return "Revisa los datos del usuario."

    texto = str(detalle)

    # Datos repetidos (llaves únicas de la base de datos)
    if "1062" in texto:

        clave = texto.split("for key '")[-1].split("'")[0].split('.')[-1]

        if clave == "usuario":
            return "Ya existe un usuario con ese nombre de usuario."

        if clave == "correo":
            return "Ya existe un usuario con ese correo."

        if clave == "numero_documento":
            return "Ya existe un funcionario con ese número de documento."

        return "Ya existe un usuario con esos datos."

    if texto.startswith("Error en la base de datos"):
        return por_defecto

    return texto


def _datos_usuario_formulario():
    """Datos del funcionario y de la cuenta que llegan del modal."""

    datos = {
        "nombre": request.form.get('nombre'),
        "apellido": request.form.get('apellido'),
        "tipo_documento": request.form.get('tipo_documento'),
        "numero_documento": request.form.get('numero_documento'),
        "usuario": request.form.get('usuario'),
        "correo": request.form.get('correo'),
        "id_rol": request.form.get('id_rol')
    }

    # El teléfono es opcional
    telefono = request.form.get('telefono', '').strip()

    if telefono:
        datos["telefono"] = telefono

    return datos

def _encriptar(contrasena):
    """Genera el hash bcrypt de la contraseña."""

    return bcrypt.hashpw(
        contrasena.encode('utf-8'),
        bcrypt.gensalt()
    ).decode('utf-8')


# ------------------------------------------------------------
# LISTA DE USUARIOS + TARJETAS
# ------------------------------------------------------------

@app.route('/usuarios')
def usuarios():

    bloqueo = _solo_administrador()

    if bloqueo:
        return bloqueo

    lista_usuarios = _obtener_json(API_USUARIOS, [])

    estadisticas = _obtener_json(
        f"{API_USUARIOS}/estadisticas",
        {
            "usuarios_registrados": 0,
            "usuarios_activos": 0,
            "usuarios_inactivos": 0
        }
    )

    roles = _obtener_json("http://127.0.0.1:8000/rol", [])
    funcionarios = _obtener_json("http://127.0.0.1:8000/funcionario", [])

    return render_template(
        'Usuarios.html',
        usuarios=lista_usuarios,
        estadisticas=estadisticas,
        roles=roles,
        funcionarios=funcionarios
    )


# ------------------------------------------------------------
# CREAR USUARIO
# ------------------------------------------------------------

@app.route('/crear_usuario', methods=['POST'])
def crear_usuario():

    bloqueo = _solo_administrador()

    if bloqueo:
        return bloqueo

    contrasena = request.form.get('contrasena', '')

    if not contrasena:
        return redirect(
            url_for('usuarios', error="La contraseña es obligatoria.")
        )

    parametros = _datos_usuario_formulario()
    parametros["contrasena"] = _encriptar(contrasena)

    try:
        respuesta = requests.post(
            API_USUARIOS,
            params=parametros,
            timeout=10
        )
    except requests.RequestException:
        return redirect(
            url_for(
                'usuarios',
                error="No se pudo conectar con el servicio de usuarios."
            )
        )

    if respuesta.status_code != 200:
        return redirect(
            url_for(
                'usuarios',
                error=_mensaje_error_usuario(
                    respuesta,
                    "No fue posible crear el usuario."
                )
            )
        )

    return redirect(url_for('usuarios'))


# ------------------------------------------------------------
# EDITAR USUARIO
# ------------------------------------------------------------

@app.route('/editar_usuario/<int:id>', methods=['POST'])
def editar_usuario(id):

    bloqueo = _solo_administrador()

    if bloqueo:
        return bloqueo

    parametros = _datos_usuario_formulario()

    # La contraseña solo se cambia si escribieron una nueva
    contrasena = request.form.get('contrasena', '')

    if contrasena:
        parametros["contrasena"] = _encriptar(contrasena)

    try:
        respuesta = requests.put(
            f"{API_USUARIOS}/{id}",
            params=parametros,
            timeout=10
        )
    except requests.RequestException:
        return redirect(
            url_for(
                'usuarios',
                error="No se pudo conectar con el servicio de usuarios."
            )
        )

    if respuesta.status_code != 200:
        return redirect(
            url_for(
                'usuarios',
                error=_mensaje_error_usuario(
                    respuesta,
                    "No fue posible actualizar el usuario."
                )
            )
        )

    return redirect(url_for('usuarios'))

# ------------------------------------------------------------
# INACTIVAR USUARIO
# ------------------------------------------------------------

@app.route('/inactivar_usuario/<int:id>', methods=['POST'])
def inactivar_usuario(id):

    bloqueo = _solo_administrador()

    if bloqueo:
        return bloqueo

    try:
        respuesta = requests.patch(
            f"{API_USUARIOS}/{id}/estado",
            timeout=10
        )
    except requests.RequestException:
        return redirect(
            url_for(
                'usuarios',
                error="No se pudo conectar con el servicio de usuarios."
            )
        )

    if respuesta.status_code != 200:
        return redirect(
            url_for(
                'usuarios',
                error=_mensaje_error_usuario(
                    respuesta,
                    "No fue posible inactivar el usuario."
                )
            )
        )

    return redirect(url_for('usuarios'))

# ============================================================
# CITAS
# ============================================================

@app.route('/citas')
def citas():

    if 'correo' not in session:
        return redirect(url_for('login'))

    fecha_busqueda = request.args.get('fecha', '')

    try:
        parametros = {}
        if fecha_busqueda:
            parametros["fecha"] = fecha_busqueda

        respuesta = requests.get(
            "http://127.0.0.1:8000/consulta_clinica",
            params=parametros,
            timeout=10
        )
        respuesta.raise_for_status()
        citas_mostrar = respuesta.json()

        respuesta_pacientes = requests.get(
            "http://127.0.0.1:8000/pacientes",
            timeout=10
        )
        respuesta_pacientes.raise_for_status()
        pacientes = respuesta_pacientes.json()

        respuesta_funcionarios = requests.get(
            "http://127.0.0.1:8000/funcionario",
            timeout=10
        )
        respuesta_funcionarios.raise_for_status()
        funcionarios = respuesta_funcionarios.json()

    except requests.RequestException:
        citas_mostrar = []
        pacientes = []
        funcionarios = []

    return render_template(
        'citas.html',
        citas=citas_mostrar,
        fecha_busqueda=fecha_busqueda,
        pacientes=pacientes,
        funcionarios=funcionarios,
        error=request.args.get('error')
    )


# ============================================================
# CREAR CITA
# ============================================================

@app.route('/crear_cita', methods=['POST'])
def crear_cita():

    if 'correo' not in session:
        return redirect(url_for('login'))

    # Solo enviar los campos que realmente pide el formulario.
    # Motivo y consultorio se guardan como NULL.
    datos = {
        "fecha": request.form.get("fecha"),
        "hora": request.form.get("hora"),
        "id_paciente": request.form.get("id_paciente"),
        "id_funcionario": request.form.get("id_funcionario"),
        "motivo": None,
        "id_consultorio": None
    }

    try:
        respuesta = requests.post(
            "http://127.0.0.1:8000/citas",
            json=datos,
            timeout=10
        )

        if respuesta.status_code not in (200, 201):
            try:
                error = respuesta.json().get(
                    "detail",
                    "No fue posible crear la cita."
                )
            except ValueError:
                error = "El servicio devolvió una respuesta inválida."

            if isinstance(error, list):
                error = "Revisa los datos ingresados."

            return redirect(
                url_for('citas', error=error)
            )

        # Google Calendar: reflejar la nueva cita en la agenda
        try:
            sincronizar_cita_google(id_cita=respuesta.json().get("id_cita"))
        except ValueError:
            pass

    except requests.RequestException:
        return redirect(
            url_for(
                'citas',
                error="No se pudo conectar con el servicio de citas."
            )
        )

    return redirect(url_for('citas'))

# ============================================================
# CANCELAR CITA
# ============================================================

@app.route('/cancelar_cita/<int:id>', methods=['POST'])
def cancelar_cita(id):

    if 'correo' not in session:
        return redirect(url_for('login'))

    requests.put(
        f"http://127.0.0.1:8000/consulta_clinica/{id}/cancelar"
    )

    # Google Calendar: quitar la cita cancelada de la agenda
    sincronizar_cita_google(id_consulta=id)

    return redirect(url_for('citas'))


# ============================================================
# REAGENDAR CITA
# ============================================================

@app.route('/reagendar_cita/<int:id>', methods=['POST'])
def reagendar_cita(id):

    if 'correo' not in session:
        return redirect(url_for('login'))

    nueva_fecha = request.form.get('fecha')
    nueva_hora = request.form.get('hora')

    if nueva_fecha and nueva_hora:

        respuesta = requests.put(
            f"http://127.0.0.1:8000/consulta_clinica/{id}/reagendar",
            params={
                "fecha": nueva_fecha,
                "hora": nueva_hora
            }
        )

        if respuesta.status_code != 200:

            error = respuesta.json().get(
                "detail",
                "No fue posible reagendar la cita"
            )

            return redirect(
                url_for(
                    'citas',
                    error=error
                )
            )

        # Google Calendar: mover el evento a la nueva fecha y hora
        sincronizar_cita_google(id_consulta=id)

    return redirect(url_for('citas'))


# ============================================================
# GOOGLE CALENDAR
# ============================================================

# Variables disponibles en todas las plantillas (las usa citas.html)
@app.context_processor
def datos_google_calendar():

    return dict(
        google_activo=google_calendar.google_configurado(),
        google_embed_url=google_calendar.url_embed_calendario(),
        google_mensaje=request.args.get('google', '')
    )


# Sincroniza UNA cita con la agenda de Google. Si Google no está
# configurado o falla, el sistema sigue funcionando normal.
def sincronizar_cita_google(id_cita=None, id_consulta=None):

    if not google_calendar.google_configurado():
        return

    try:
        respuesta = requests.get(
            "http://127.0.0.1:8000/consulta_clinica", timeout=10
        )

        for cita in respuesta.json():

            if (
                (id_cita and cita["id_cita"] == id_cita)
                or (id_consulta and cita["id_consulta_clinica"] == id_consulta)
            ):
                google_calendar.sincronizar_cita(cita)
                break

    except Exception as e:
        print(f"[Google Calendar] No se pudo sincronizar la cita: {e}")


# Botón "Sincronizar citas": sube todas las citas de la BD a Google
@app.route('/sincronizar_google', methods=['POST'])
def sincronizar_google():

    if 'correo' not in session:
        return redirect(url_for('login'))

    if not google_calendar.google_configurado():
        return redirect(url_for(
            'citas',
            error="Google Calendar no está configurado "
                  "(falta GOOGLE_CALENDAR_ID o credenciales_google.json)."
        ))

    try:
        respuesta = requests.get(
            "http://127.0.0.1:8000/consulta_clinica", timeout=10
        )

        resumen = google_calendar.sincronizar_todas(respuesta.json())

    except requests.RequestException:
        return redirect(url_for(
            'citas',
            error="No se pudo conectar con el servicio de citas."
        ))

    mensaje = (
        f"{resumen['creadas']} creadas, "
        f"{resumen['actualizadas']} actualizadas, "
        f"{resumen['eliminadas']} canceladas retiradas"
    )

    if resumen['errores']:
        mensaje += f", {resumen['errores']} con error"

    return redirect(url_for('citas', google=mensaje) + '#agendaGoogle')


# ============================================================
# ESPECIALISTAS
# ============================================================

@app.route('/especialista')
def especi():

    if 'correo' not in session:
        return redirect(url_for('login'))

    return render_template(
        'especialistas.html'
    )


# ============================================================
# HISTORIA CLÍNICA
# ============================================================

@app.route('/Histclinico')
def hclinico():

    if 'correo' not in session:
        return redirect(url_for('login'))

    try:

        respuesta = requests.get(
            "http://127.0.0.1:8000/pacientes",
            timeout=10
        )

        respuesta.raise_for_status()

        pacientes = respuesta.json()

    except requests.RequestException:

        pacientes = []

    return render_template(
        'htclinico.html',
        pacientes=pacientes
    )


# ============================================================
# BUSCAR HISTORIAL POR DOCUMENTO
# ============================================================

@app.route('/buscar_historial/<numero_documento>')
def buscar_historial(numero_documento):

    if 'correo' not in session:
        return {
            "error": "No autorizado"
        }, 401

    respuesta = requests.get(
        f"http://127.0.0.1:8000/historial/{numero_documento}"
    )

    if respuesta.status_code == 404:

        return {
            "error": "Paciente no encontrado"
        }, 404

    return respuesta.json()


# ============================================================
# REPORTES
# ============================================================

COLUMNAS_REPORTE = {

    "pacientes": [
        ("ID", "id_paciente"),
        ("Tipo documento", "tipo_documento"),
        ("Documento", "numero_documento"),
        ("Nombre", "nombre"),
        ("Apellido", "apellido"),
        ("Fecha nacimiento", "fecha_nacimiento"),
        ("Sexo", "sexo"),
        ("Teléfono", "telefono"),
        ("Correo", "correo"),
        ("Dirección", "direccion"),
        ("EPS", "eps"),
        ("Estado", "estado"),
    ],

    "historias": [
        ("ID consulta", "id_consulta_clinica"),
        ("ID paciente", "id_paciente"),
        ("Paciente", "paciente"),
        ("Documento", "numero_documento"),
        ("Fecha", "fecha"),
        ("Hora", "hora"),
        ("Odontólogo", "odontologo"),
        ("Consultorio", "consultorio"),
        ("Estado", "estado"),
        ("Motivo consulta", "motivo_consulta"),
        ("Enfermedad actual", "enfermedad_actual"),
        ("Antecedentes", "antecedentes"),
        ("Observaciones", "observaciones"),
        ("Diagnóstico", "diagnostico"),
        ("Tratamiento", "tratamiento"),
    ],

    "usuarios": [
        ("ID", "id_usuario"),
        ("Usuario", "usuario"),
        ("Correo", "correo"),
        ("Rol", "rol"),
        ("Estado", "estado"),
    ],

    "odontologo": [
        ("ID paciente", "id_paciente"),
        ("Paciente", "paciente"),
        ("Documento", "numero_documento"),
        ("Teléfono", "telefono"),
        ("Correo", "correo"),
        ("Fecha atención", "fecha"),
        ("Hora", "hora"),
        ("Odontólogo", "odontologo"),
        ("Consultorio", "consultorio"),
        ("Estado cita", "estado"),
        ("Motivo consulta", "motivo_consulta"),
        ("Enfermedad actual", "enfermedad_actual"),
        ("Antecedentes", "antecedentes"),
        ("Observaciones", "observaciones"),
        ("Diagnóstico", "diagnostico"),
        ("Tratamiento", "tratamiento"),
    ],
}


NOMBRES_REPORTES = {

    "pacientes": "Pacientes registrados",

    "historias": "Historias clínicas",

    "usuarios": "Usuarios del sistema",

    "odontologo": "Pacientes por odontólogo",
}


# ============================================================
# CONEXIÓN PARA REPORTES
# ============================================================

def _conexion_reportes():

    return crear_conexion()


# ============================================================
# NORMALIZAR VALORES
# ============================================================

def _normalizar_valor(valor):

    if valor is None:
        return ""

    if hasattr(valor, "strftime"):

        try:
            return valor.strftime(
                "%d/%m/%Y %H:%M"
            )

        except ValueError:

            return valor.strftime(
                "%d/%m/%Y"
            )

    return str(valor)


# ============================================================
# OBTENER ODONTÓLOGOS
# ============================================================

def obtener_odontologos_reporte():

    conexion = None

    try:

        conexion = _conexion_reportes()

        with conexion.cursor() as cursor:

            cursor.execute("""
                SELECT
                    id_funcionario,
                    CONCAT(nombre, ' ', apellido) AS nombre_completo
                FROM funcionario
                ORDER BY nombre, apellido
            """)

            return cursor.fetchall()

    finally:

        if conexion:
            conexion.close()


# ============================================================
# CONDICIONES DE FECHA
# ============================================================

def _condiciones_fecha(
    fecha_inicial,
    fecha_final,
    columna="cc.fecha"
):

    condiciones = []
    parametros = []

    if fecha_inicial:

        condiciones.append(
            f"{columna} >= %s"
        )

        parametros.append(
            fecha_inicial
        )

    if fecha_final:

        condiciones.append(
            f"{columna} <= %s"
        )

        parametros.append(
            fecha_final
        )

    return condiciones, parametros




# ============================================================
# OBTENER REPORTE
# ============================================================

def obtener_reporte(
    tipo,
    fecha_inicial="",
    fecha_final="",
    odontologo=""
):

    if tipo not in COLUMNAS_REPORTE:
        tipo = "pacientes"

    conexion = None

    try:

        conexion = _conexion_reportes()

        with conexion.cursor() as cursor:

            # ------------------------------------------------
            # PACIENTES
            # ------------------------------------------------

            if tipo == "pacientes":

                sql = """
                    SELECT
                        p.id_paciente,
                        p.tipo_documento,
                        p.numero_documento,
                        p.nombre,
                        p.apellido,
                        p.fecha_nacimiento,
                        p.sexo,
                        p.telefono,
                        p.correo,
                        p.direccion,
                        p.eps,
                        p.estado
                    FROM paciente p
                    ORDER BY p.apellido, p.nombre
                """

                cursor.execute(sql)

            # ------------------------------------------------
            # USUARIOS
            # ------------------------------------------------

            elif tipo == "usuarios":

                sql = """
                    SELECT
                        u.id_usuario,
                        u.usuario,
                        u.correo,
                        COALESCE(
                            r.nombre_rol,
                            'Sin rol'
                        ) AS rol,
                        u.estado
                    FROM Usuario u
                    LEFT JOIN Rol r
                        ON r.id_rol = u.id_rol
                    ORDER BY u.usuario
                """

                cursor.execute(sql)

            # ------------------------------------------------
            # HISTORIAS / ODONTÓLOGO
            # ------------------------------------------------

            else:

                condiciones, parametros = _condiciones_fecha(
                    fecha_inicial,
                    fecha_final,
                    "cc.fecha"
                )

                if odontologo and odontologo != "todos":

                    condiciones.append(
                        "cc.id_funcionario = %s"
                    )

                    parametros.append(
                        int(odontologo)
                    )

                where = (
                    "WHERE " +
                    " AND ".join(condiciones)
                    if condiciones
                    else ""
                )

                sql_base = """

                    SELECT

                        cc.id_consulta_clinica,

                        p.id_paciente,

                        CONCAT(
                            p.nombre,
                            ' ',
                            p.apellido
                        ) AS paciente,

                        p.numero_documento,

                        p.telefono,

                        p.correo,

                        cc.fecha,

                        LEFT(
                            c.hora,
                            5
                        ) AS hora,

                        CONCAT(
                            f.nombre,
                            ' ',
                            f.apellido
                        ) AS odontologo,

                        COALESCE(
                            co.nombre_consultorio,
                            ''
                        ) AS consultorio,

                        COALESCE(
                            c.estado,
                            ''
                        ) AS estado,

                        cc.motivo_consulta,

                        cc.enfermedad_actual,

                        cc.antecedentes,

                        cc.observaciones,

                        COALESCE(
                            GROUP_CONCAT(
                                DISTINCT d.descripcion
                                SEPARATOR ' | '
                            ),
                            ''
                        ) AS diagnostico,

                        COALESCE(
                            GROUP_CONCAT(
                                DISTINCT t.nombre
                                SEPARATOR ' | '
                            ),
                            ''
                        ) AS tratamiento

                    FROM consulta_clinica cc

                    INNER JOIN paciente p
                        ON p.id_paciente =
                           cc.id_paciente

                    LEFT JOIN funcionario f
                        ON f.id_funcionario =
                           cc.id_funcionario

                    LEFT JOIN cita c
                        ON c.id_cita =
                           cc.id_cita

                    LEFT JOIN consultorio co
                        ON co.id_consultorio =
                           c.id_consultorio

                    LEFT JOIN diagnostico d
                        ON d.id_consulta_clinica =
                           cc.id_consulta_clinica

                    LEFT JOIN tratamiento t
                        ON t.id_consulta_clinica =
                           cc.id_consulta_clinica
                """

                group_order = """

                    GROUP BY
                        cc.id_consulta_clinica,
                        p.id_paciente,
                        p.nombre,
                        p.apellido,
                        p.numero_documento,
                        p.telefono,
                        p.correo,
                        cc.fecha,
                        c.hora,
                        f.nombre,
                        f.apellido,
                        co.nombre_consultorio,
                        c.estado,
                        cc.motivo_consulta,
                        cc.enfermedad_actual,
                        cc.antecedentes,
                        cc.observaciones

                    ORDER BY
                        cc.fecha DESC,
                        c.hora DESC
                """

                cursor.execute(
                    sql_base +
                    "\n" +
                    where +
                    "\n" +
                    group_order,
                    parametros
                )

            filas = cursor.fetchall()

        return filas

    finally:

        if conexion:
            conexion.close()


# ============================================================
# PREPARAR FILAS
# ============================================================

def _preparar_filas(tipo, filas):

    columnas = COLUMNAS_REPORTE[tipo]

    return [

        [
            _normalizar_valor(
                fila.get(clave)
            )

            for _, clave in columnas
        ]

        for fila in filas
    ]


# ============================================================
# PÁGINA DE REPORTES
# ============================================================

@app.route('/reportes')
def report():

    if 'correo' not in session:
        return redirect(url_for('login'))

    tipo = request.args.get(
        'tipo',
        'pacientes'
    )

    if tipo not in COLUMNAS_REPORTE:
        tipo = 'pacientes'

    fecha_inicial = request.args.get(
        'fecha_inicial',
        ''
    )

    fecha_final = request.args.get(
        'fecha_final',
        ''
    )

    odontologo = request.args.get(
        'odontologo',
        'todos'
    )

    error = None
    filas = []
    odontologos = []

    try:

        odontologos = obtener_odontologos_reporte()

        filas = obtener_reporte(
            tipo,
            fecha_inicial,
            fecha_final,
            odontologo
        )

    except (
        pymysql.Error,
        ValueError,
        requests.RequestException
    ) as exc:

        error = (
            f"No fue posible generar "
            f"el reporte: {exc}"
        )

    columnas = COLUMNAS_REPORTE[tipo]

    # --------------------------------------------------------
    # CONTEOS REALES
    # --------------------------------------------------------

    conexion = None

    try:

        conexion = _conexion_reportes()

        with conexion.cursor() as cursor:

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM paciente
                WHERE estado = 'activo'
            """)

            total_pacientes = cursor.fetchone()['total']

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM consulta_clinica
            """)

            total_historias = cursor.fetchone()['total']

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM funcionario
            """)

            total_odontologos = cursor.fetchone()['total']

            cursor.execute("""
                SELECT COUNT(*) AS total
                FROM Usuario
                WHERE estado = 'activo'
            """)

            total_usuarios = cursor.fetchone()['total']

    except pymysql.Error:

        total_pacientes = 0
        total_historias = 0
        total_odontologos = 0
        total_usuarios = 0

    finally:

        if conexion:

            try:
                conexion.close()

            except Exception:
                pass

    return render_template(
        'reportes.html',

        filas=filas,

        columnas=columnas,

        odontologos=odontologos,

        tipo=tipo,

        nombre_reporte=NOMBRES_REPORTES[tipo],

        fecha_inicial=fecha_inicial,

        fecha_final=fecha_final,

        odontologo_seleccionado=odontologo,

        error=error,

        total_pacientes=total_pacientes,

        total_historias=total_historias,

        total_odontologos=total_odontologos,

        total_usuarios=total_usuarios,

        total_resultados=len(filas),
    )


# ============================================================
# FILTROS DE EXPORTACIÓN
# ============================================================

def _filtros_exportacion():

    tipo = request.args.get(
        'tipo',
        'pacientes'
    )

    if tipo not in COLUMNAS_REPORTE:
        tipo = 'pacientes'

    fecha_inicial = request.args.get(
        'fecha_inicial',
        ''
    )

    fecha_final = request.args.get(
        'fecha_final',
        ''
    )

    odontologo = request.args.get(
        'odontologo',
        'todos'
    )

    return (
        tipo,
        fecha_inicial,
        fecha_final,
        odontologo
    )


# ============================================================
# EXPORTAR EXCEL
# ============================================================

@app.route('/exportar_excel')
def exportar_excel():

    if 'correo' not in session:
        return redirect(url_for('login'))

    try:

        (
            tipo,
            fecha_inicial,
            fecha_final,
            odontologo
        ) = _filtros_exportacion()

        filas = obtener_reporte(
            tipo,
            fecha_inicial,
            fecha_final,
            odontologo
        )

        columnas = COLUMNAS_REPORTE[tipo]

        datos = _preparar_filas(
            tipo,
            filas
        )

    except (
        pymysql.Error,
        ValueError
    ) as exc:

        return (
            f"No se pudo generar "
            f"el Excel: {exc}"
        ), 500

    wb = Workbook()

    ws = wb.active

    ws.title = "Reporte"

    # Encabezados
    ws.append([
        nombre
        for nombre, _ in columnas
    ])

    # Datos
    for fila in datos:
        ws.append(fila)

    # Formato
    for cell in ws[1]:

        cell.font = cell.font.copy(
            bold=True
        )

        cell.alignment = cell.alignment.copy(
            horizontal='center',
            vertical='center'
        )

    ws.freeze_panes = "A2"

    ws.auto_filter.ref = ws.dimensions

    # Ancho de columnas
    for col in ws.columns:

        max_len = max(
            len(str(cell.value or ""))
            for cell in col
        )

        ws.column_dimensions[
            col[0].column_letter
        ].width = min(
            max(max_len + 2, 12),
            45
        )

    archivo = BytesIO()

    wb.save(archivo)

    archivo.seek(0)

    nombre = f"reporte_{tipo}.xlsx"

    return send_file(
        archivo,
        as_attachment=True,
        download_name=nombre,
        mimetype=(
            "application/vnd.openxmlformats-"
            "officedocument.spreadsheetml.sheet"
        )
    )


# ============================================================
# EXPORTAR PDF
# ============================================================

@app.route('/exportar_pdf')
def exportar_pdf():

    if 'correo' not in session:
        return redirect(url_for('login'))

    try:

        (
            tipo,
            fecha_inicial,
            fecha_final,
            odontologo
        ) = _filtros_exportacion()

        filas = obtener_reporte(
            tipo,
            fecha_inicial,
            fecha_final,
            odontologo
        )

        columnas = COLUMNAS_REPORTE[tipo]

        datos = _preparar_filas(
            tipo,
            filas
        )

    except (
        pymysql.Error,
        ValueError
    ) as exc:

        return (
            f"No se pudo generar "
            f"el PDF: {exc}"
        ), 500

    archivo = BytesIO()

    documento = SimpleDocTemplate(

        archivo,

        pagesize=landscape(letter),

        rightMargin=25,

        leftMargin=25,

        topMargin=30,

        bottomMargin=30,

        title=(
            f"{NOMBRES_REPORTES[tipo]}"
            " - Smile Cloud"
        )
    )

    estilos = getSampleStyleSheet()

    estilo_celda = estilos["BodyText"]

    estilo_celda.fontName = "Helvetica"

    estilo_celda.fontSize = 6.5

    estilo_celda.leading = 8

    estilo_titulo = estilos["Title"]

    estilo_titulo.fontSize = 18

    elementos = [

        Paragraph(
            "Smile Cloud",
            estilo_titulo
        ),

        Paragraph(
            NOMBRES_REPORTES[tipo],
            estilos["Heading2"]
        ),

        Spacer(1, 8),
    ]

    filtros_texto = []

    if fecha_inicial:

        filtros_texto.append(
            f"Desde: {fecha_inicial}"
        )

    if fecha_final:

        filtros_texto.append(
            f"Hasta: {fecha_final}"
        )

    if tipo == "odontologo":

        nombre_odontologo = "Todos"

        for o in obtener_odontologos_reporte():

            if str(
                o['id_funcionario']
            ) == str(odontologo):

                nombre_odontologo = (
                    o['nombre_completo']
                )

                break

        filtros_texto.append(
            f"Odontólogo: {nombre_odontologo}"
        )

    if filtros_texto:

        elementos.append(
            Paragraph(
                " | ".join(filtros_texto),
                estilos["Normal"]
            )
        )

        elementos.append(
            Spacer(1, 8)
        )

    # --------------------------------------------------------
    # TABLA
    # --------------------------------------------------------

    if datos:

        encabezados = [

            Paragraph(
                str(nombre),
                estilo_celda
            )

            for nombre, _ in columnas
        ]

        tabla_datos = [
            encabezados
        ]

        for fila in datos:

            tabla_datos.append([

                Paragraph(
                    str(valor),
                    estilo_celda
                )

                for valor in fila
            ])

        tabla = Table(
            tabla_datos,
            repeatRows=1,
            hAlign="LEFT"
        )

        tabla.setStyle(
            TableStyle([

                (
                    "BACKGROUND",
                    (0, 0),
                    (-1, 0),
                    colors.HexColor("#243447")
                ),

                (
                    "TEXTCOLOR",
                    (0, 0),
                    (-1, 0),
                    colors.white
                ),

                (
                    "FONTNAME",
                    (0, 0),
                    (-1, 0),
                    "Helvetica-Bold"
                ),

                (
                    "GRID",
                    (0, 0),
                    (-1, -1),
                    0.35,
                    colors.HexColor("#B8C2CC")
                ),

                (
                    "FONTSIZE",
                    (0, 0),
                    (-1, -1),
                    6.5
                ),

                (
                    "VALIGN",
                    (0, 0),
                    (-1, -1),
                    "TOP"
                ),

                (
                    "LEFTPADDING",
                    (0, 0),
                    (-1, -1),
                    4
                ),

                (
                    "RIGHTPADDING",
                    (0, 0),
                    (-1, -1),
                    4
                ),

                (
                    "TOPPADDING",
                    (0, 0),
                    (-1, 0),
                    6
                ),

                (
                    "BOTTOMPADDING",
                    (0, 0),
                    (-1, 0),
                    6
                ),
            ])
        )

        elementos.append(tabla)

    else:

        elementos.append(
            Paragraph(
                "No se encontraron registros "
                "con los filtros seleccionados.",
                estilos["Normal"]
            )
        )

    elementos.append(
        Spacer(1, 10)
    )

    elementos.append(
        Paragraph(
            f"Total de registros: {len(datos)}",
            estilos["Normal"]
        )
    )

    documento.build(elementos)

    archivo.seek(0)

    return send_file(
        archivo,
        as_attachment=True,
        download_name=f"reporte_{tipo}.pdf",
        mimetype="application/pdf"
    )


# ============================================================
# EJECUTAR APLICACIÓN
# ============================================================

if __name__ == '__main__':

    app.run(
        debug=True
    )
