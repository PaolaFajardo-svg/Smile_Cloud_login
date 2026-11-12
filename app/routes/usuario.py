from fastapi import APIRouter, Depends, HTTPException
from app.database import bd_conexion

router = APIRouter()


# Consultar usuarios para la tabla (con los datos de su funcionario)
@router.get("/usuario")
def listar_usuarios(conexion=Depends(bd_conexion)):
    with conexion.cursor() as cursor:
        cursor.execute("""
            SELECT
                u.id_usuario,
                u.usuario,
                u.correo,
                u.estado,
                u.id_funcionario,
                u.id_rol,
                r.nombre AS rol,
                f.nombre,
                f.apellido,
                f.tipo_documento,
                f.numero_documento,
                f.telefono
            FROM usuario AS u
            INNER JOIN rol AS r
                ON u.id_rol = r.id_rol
            INNER JOIN funcionario AS f
                ON u.id_funcionario = f.id_funcionario
            ORDER BY u.id_usuario DESC
        """)

        return cursor.fetchall()


# Consultar estadísticas para las tres tarjetas
@router.get("/usuario/estadisticas")
def estadisticas_usuarios(conexion=Depends(bd_conexion)):
    with conexion.cursor() as cursor:
        cursor.execute("""
            SELECT
                COUNT(*) AS usuarios_registrados,
                COALESCE(
                    SUM(estado = 'Activo'), 0
                ) AS usuarios_activos,
                COALESCE(
                    SUM(estado = 'Inactivo'), 0
                ) AS usuarios_inactivos
            FROM usuario
        """)

        return cursor.fetchone()


# Crear usuario: guarda el funcionario y su cuenta (las dos tablas)
@router.post("/usuario")
def crear_usuario_sql(
    nombre: str,
    apellido: str,
    tipo_documento: str,
    numero_documento: str,
    usuario: str,
    contrasena: str,
    correo: str,
    id_rol: int,
    telefono: str = None,
    conexion=Depends(bd_conexion)
):
    with conexion.cursor() as cursor:

        # 1. Datos personales en la tabla funcionario
        cursor.execute("""
            INSERT INTO funcionario (
                nombre,
                apellido,
                tipo_documento,
                numero_documento,
                telefono,
                correo
            )
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (
            nombre,
            apellido,
            tipo_documento,
            numero_documento,
            telefono,
            correo
        ))

        id_funcionario = cursor.lastrowid

        # 2. Cuenta de acceso en la tabla usuario
        cursor.execute("""
            INSERT INTO usuario (
                usuario,
                contrasena,
                correo,
                estado,
                id_funcionario,
                id_rol
            )
            VALUES (%s, %s, %s, 'Activo', %s, %s)
        """, (
            usuario,
            contrasena,
            correo,
            id_funcionario,
            id_rol
        ))

        return {
            "id_usuario": cursor.lastrowid,
            "id_funcionario": id_funcionario
        }


# Editar usuario: actualiza el funcionario y su cuenta
@router.put("/usuario/{id_usuario}")
def editar_usuario_sql(
    id_usuario: int,
    nombre: str,
    apellido: str,
    tipo_documento: str,
    numero_documento: str,
    usuario: str,
    correo: str,
    id_rol: int,
    telefono: str = None,
    contrasena: str = None,
    conexion=Depends(bd_conexion)
):
    with conexion.cursor() as cursor:

        # Buscar el funcionario que pertenece a este usuario
        cursor.execute("""
            SELECT id_funcionario
            FROM usuario
            WHERE id_usuario = %s
        """, (id_usuario,))

        fila = cursor.fetchone()

        if not fila:
            raise HTTPException(
                status_code=404,
                detail="El usuario no existe"
            )

        # 1. Datos personales
        cursor.execute("""
            UPDATE funcionario
            SET nombre = %s,
                apellido = %s,
                tipo_documento = %s,
                numero_documento = %s,
                telefono = %s,
                correo = %s
            WHERE id_funcionario = %s
        """, (
            nombre,
            apellido,
            tipo_documento,
            numero_documento,
            telefono,
            correo,
            fila["id_funcionario"]
        ))

        # 2. Cuenta de acceso
        if contrasena:
            cursor.execute("""
                UPDATE usuario
                SET usuario = %s,
                    correo = %s,
                    contrasena = %s,
                    id_rol = %s
                WHERE id_usuario = %s
            """, (
                usuario,
                correo,
                contrasena,
                id_rol,
                id_usuario
            ))
        else:
            cursor.execute("""
                UPDATE usuario
                SET usuario = %s,
                    correo = %s,
                    id_rol = %s
                WHERE id_usuario = %s
            """, (
                usuario,
                correo,
                id_rol,
                id_usuario
            ))

        return {"mensaje": "Usuario actualizado correctamente"}


# Inactivar usuario
@router.patch("/usuario/{id_usuario}/estado")
def inactivar_usuario_sql(
    id_usuario: int,
    conexion=Depends(bd_conexion)
):
    with conexion.cursor() as cursor:
        cursor.execute("""
            UPDATE usuario
            SET estado = 'Inactivo'
            WHERE id_usuario = %s
        """, (id_usuario,))

        return cursor.rowcount