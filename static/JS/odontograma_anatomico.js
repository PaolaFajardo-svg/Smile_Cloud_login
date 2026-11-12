/* SmileCloud - Odontograma anatómico interactivo */

const dientesSuperiores = [
    18, 17, 16, 15, 14, 13, 12, 11,
    21, 22, 23, 24, 25, 26, 27, 28
];

const dientesInferiores = [
    48, 47, 46, 45, 44, 43, 42, 41,
    31, 32, 33, 34, 35, 36, 37, 38
];

const condiciones = {
    caries: {
        color: "#e85d63",
        simbolo: "●",
        nombre: "Caries"
    },

    restauracion: {
        color: "#478bd1",
        simbolo: "■",
        nombre: "Restauración"
    },

    sellante: {
        color: "#24aeb5",
        simbolo: "▲",
        nombre: "Sellante"
    },

    corona: {
        color: "#d6a629",
        simbolo: "△",
        nombre: "Corona"
    },

    endodoncia: {
        color: "#9565cf",
        simbolo: "│",
        nombre: "Endodoncia"
    },

    implante: {
        color: "#a87349",
        simbolo: "✚",
        nombre: "Implante"
    },

    protesis: {
        color: "#db75a6",
        simbolo: "◆",
        nombre: "Prótesis"
    },

    fractura: {
        color: "#f28b43",
        simbolo: "★",
        nombre: "Fractura"
    }
};

// Almacena las condiciones temporalmente en el navegador.
const estadoDientes = {};

let dienteSeleccionado = null;
let superficieSeleccionada = null;


// IDENTIFICAR EL TIPO DE DIENTE

function tipoDiente(numero) {
    const n = numero % 10;

    if (n === 1 || n === 2) {
        return "incisivo";
    }

    if (n === 3) {
        return "canino";
    }

    if (n === 4 || n === 5) {
        return "premolar";
    }

    return "molar";
}


// OBTENER LAS SUPERFICIES DE CADA DIENTE

function superficiesPara(numero) {
    const esInferior =
        (numero >= 31 && numero <= 38) ||
        (numero >= 41 && numero <= 48);

    const superficies = [
        "mesial",
        "distal",
        "vestibular",
        esInferior ? "lingual" : "palatina"
    ];

    const tipo = tipoDiente(numero);

    if (tipo === "incisivo" || tipo === "canino") {
        superficies.push("incisal");
    } else {
        superficies.push("oclusal");
    }

    return superficies;
}


// FORMA BÁSICA DE LOS DIENTES

function formaDiente(numero) {
    const tipo = tipoDiente(numero);

    if (tipo === "incisivo") {
        return `
            M10 10 Q22 3 34 10
            L38 27 Q37 43 31 55
            L27 64 L17 64 L13 55
            Q7 43 6 27 Z
        `;
    }

    if (tipo === "canino") {
        return `
            M22 4 Q34 8 35 22
            L31 43 L22 66 L13 43
            L9 22 Q10 8 22 4 Z
        `;
    }

    if (tipo === "premolar") {
        return `
            M11 8 Q22 2 33 8
            Q40 17 36 32 L31 54
            Q27 63 22 62 Q17 63 13 54
            L8 32 Q4 17 11 8 Z
        `;
    }

    return `
        M10 8 Q22 2 34 8
        Q41 14 38 29 L34 52
        Q31 62 25 62 L19 62
        Q13 62 10 52 L6 29
        Q3 14 10 8 Z
    `;
}


// FORMAS DE LAS SUPERFICIES

function zonaPath(nombre, numero) {
    const mapa = {
        vestibular: `
            M8 20 Q22 11 36 20
            L33 35 Q22 41 11 35 Z
        `,

        palatina: `
            M12 39 Q22 34 32 39
            L29 53 Q22 59 15 53 Z
        `,

        lingual: `
            M12 39 Q22 34 32 39
            L29 53 Q22 59 15 53 Z
        `,

        mesial: `
            M7 22 L16 27 L18 51
            L13 53 L8 35 Z
        `,

        distal: `
            M37 22 L28 27 L26 51
            L31 53 L36 35 Z
        `,

        oclusal: `
            M13 27 Q22 20 31 27
            L29 43 Q22 49 15 43 Z
        `,

        incisal: `
            M12 16 Q22 11 32 16
            L31 25 Q22 30 13 25 Z
        `
    };

    const tipo = tipoDiente(numero);

    if (
        (tipo === "incisivo" || tipo === "canino") &&
        nombre === "oclusal"
    ) {
        return mapa.incisal;
    }

    return mapa[nombre] || mapa.oclusal;
}


// CREAR CADA DIENTE

function crearDiente(numero) {
    const elemento = document.createElement("div");

    elemento.className = "diente";
    elemento.dataset.diente = numero;

    const superficies = superficiesPara(numero);

    elemento.innerHTML = `
        <span class="numero-diente">${numero}</span>

        <svg
            viewBox="0 0 44 70"
            role="img"
            aria-label="Diente ${numero}"
        >
            <path
                class="silueta"
                d="${formaDiente(numero)}"
            ></path>

            ${superficies.map(nombre => `
                <path
                    class="zona-superficie"
                    data-superficie="${nombre}"
                    d="${zonaPath(nombre, numero)}"
                    aria-label="${nombre}"
                ></path>
            `).join("")}

            <text
                class="marca-condicion"
                x="22"
                y="36"
                fill="transparent"
            ></text>
        </svg>
    `;

    elemento
        .querySelectorAll(".zona-superficie")
        .forEach(zona => {
            zona.addEventListener("click", evento => {
                evento.stopPropagation();

                seleccionarSuperficie(
                    numero,
                    zona.dataset.superficie,
                    zona
                );
            });
        });

    return elemento;
}


// CARGAR LOS 32 DIENTES

function cargarDientes() {
    const superiores = document.getElementById(
        "dientesSuperiores"
    );

    const inferiores = document.getElementById(
        "dientesInferiores"
    );

    dientesSuperiores.forEach(numero => {
        superiores.appendChild(crearDiente(numero));
    });

    dientesInferiores.forEach(numero => {
        inferiores.appendChild(crearDiente(numero));
    });
}


// SELECCIONAR UNA SUPERFICIE

function seleccionarSuperficie(numero, superficie, zona) {
    document
        .querySelectorAll(".zona-superficie.seleccionada")
        .forEach(elemento => {
            elemento.classList.remove("seleccionada");
        });

    document
        .querySelectorAll(".diente.seleccionado")
        .forEach(elemento => {
            elemento.classList.remove("seleccionado");
        });

    zona.classList.add("seleccionada");

    zona.closest(".diente").classList.add("seleccionado");

    dienteSeleccionado = numero;
    superficieSeleccionada = superficie;

    const nombres = {
        mesial: "Mesial",
        distal: "Distal",
        vestibular: "Vestibular",
        palatina: "Palatina",
        lingual: "Lingual",
        oclusal: "Oclusal",
        incisal: "Incisal"
    };

    document.getElementById(
        "superficieSeleccionada"
    ).textContent =
        `Diente ${numero} · Cara ${nombres[superficie]}`;

    actualizarBotonesCondicion();
}


// RESALTAR LA CONDICIÓN ACTUAL

function actualizarBotonesCondicion() {
    document
        .querySelectorAll(".condicion")
        .forEach(boton => {
            boton.classList.remove("activa");
        });

    if (
        dienteSeleccionado === null ||
        superficieSeleccionada === null
    ) {
        return;
    }

    const clave =
        `${dienteSeleccionado}-${superficieSeleccionada}`;

    const condicionActual = estadoDientes[clave];

    if (condicionActual) {
        const boton = document.querySelector(
            `.condicion[data-condicion="${condicionActual}"]`
        );

        if (boton) {
            boton.classList.add("activa");
        }
    }
}


// REGISTRAR UNA CONDICIÓN

function pintarCondicion(condicion) {
    if (
        dienteSeleccionado === null ||
        superficieSeleccionada === null
    ) {
        // NUEVO: aviso con SweetAlert2 (antes era alert)
        scAviso(
            "Selecciona una superficie",
            "Primero elige una superficie de un diente.",
            "info"
        );

        return;
    }

    const clave =
        `${dienteSeleccionado}-${superficieSeleccionada}`;

    estadoDientes[clave] = condicion;

    const diente = document.querySelector(
        `.diente[data-diente="${dienteSeleccionado}"]`
    );

    const marca = diente.querySelector(
        ".marca-condicion"
    );

    const dato = condiciones[condicion];

    marca.textContent = dato.simbolo;
    marca.setAttribute("fill", dato.color);

    actualizarBotonesCondicion();
}


// LIMPIAR LA SUPERFICIE SELECCIONADA

function limpiarSuperficie() {
    if (
        dienteSeleccionado === null ||
        superficieSeleccionada === null
    ) {
        // NUEVO: aviso con SweetAlert2 (antes era alert)
        scAviso(
            "Selecciona una superficie",
            "Elige primero la superficie que deseas limpiar.",
            "info"
        );

        return;
    }

    const clave =
        `${dienteSeleccionado}-${superficieSeleccionada}`;

    delete estadoDientes[clave];

    const diente = document.querySelector(
        `.diente[data-diente="${dienteSeleccionado}"]`
    );

    const marca = diente.querySelector(
        ".marca-condicion"
    );

    // Cada diente tiene una marca visual central.
    // Si quedan condiciones en otras caras, se muestra una de ellas.
    const restantes = Object.keys(estadoDientes).filter(
        llave => llave.startsWith(`${dienteSeleccionado}-`)
    );

    if (restantes.length === 0) {
        marca.textContent = "";
        marca.setAttribute("fill", "transparent");
    } else {
        const dato = condiciones[
            estadoDientes[restantes[0]]
        ];

        marca.textContent = dato.simbolo;
        marca.setAttribute("fill", dato.color);
    }

    actualizarBotonesCondicion();
}


// REINICIAR TODO EL ODONTOGRAMA

// NUEVO: la confirmación ahora es con SweetAlert2 (antes era confirm).
// Es asíncrona, por eso el reinicio real quedó en otra función.
function reiniciarOdontograma() {
    scConfirmar({
        titulo: "¿Borrar todas las marcas?",
        texto: "Se limpiará todo el odontograma.",
        ok: "Sí, borrar",
        peligro: true
    }).then(function (acepto) {
        if (acepto) {
            ejecutarReinicioOdontograma();
        }
    });
}

function ejecutarReinicioOdontograma() {
    Object.keys(estadoDientes).forEach(clave => {
        delete estadoDientes[clave];
    });

    document
        .querySelectorAll(".marca-condicion")
        .forEach(marca => {
            marca.textContent = "";
            marca.setAttribute("fill", "transparent");
        });

    document
        .querySelectorAll(".zona-superficie.seleccionada")
        .forEach(zona => {
            zona.classList.remove("seleccionada");
        });

    document
        .querySelectorAll(".diente.seleccionado")
        .forEach(diente => {
            diente.classList.remove("seleccionado");
        });

    dienteSeleccionado = null;
    superficieSeleccionada = null;

    document.getElementById(
        "superficieSeleccionada"
    ).textContent =
        "Selecciona una superficie del diente";

    document
        .querySelectorAll(".condicion")
        .forEach(boton => {
            boton.classList.remove("activa");
        });

    document.getElementById(
        "observaciones"
    ).value = "";
}


// EVENTOS DE LOS BOTONES

document.querySelectorAll(".condicion").forEach(boton => {
    boton.addEventListener("click", () => {
        pintarCondicion(boton.dataset.condicion);
    });
});

document.getElementById(
    "limpiarSuperficie"
).addEventListener("click", limpiarSuperficie);

document.getElementById(
    "reiniciar"
).addEventListener("click", reiniciarOdontograma);


// INICIAR EL ODONTOGRAMA

cargarDientes();