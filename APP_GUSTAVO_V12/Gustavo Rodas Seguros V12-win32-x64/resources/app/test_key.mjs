import fetch from 'node-fetch';

const apiKey = 'AIzaSyDpvE8ig0gX78vh_OceaQZkzH79IbrF8CM';

async function testKey() {
    console.log("--- Diagnóstico de API Key ---");
    console.log("Key:", apiKey.substring(0, 6) + "...");

    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await res.json();

        if (data.error) {
            console.error("Error de API:", data.error.message);
            return;
        }

        console.log("Modelos disponibles:");
        data.models.forEach(m => console.log("- " + m.name));

    } catch (err) {
        console.error("Error de conexión:", err.message);
    }
}

testKey();
