
import { GoogleGenAI, Type } from "@google/genai";
import { AccelerationData, GeminiAnalysis, SessionStats } from "../types";

export const analyzeMotionSession = async (data: AccelerationData[], stats: SessionStats): Promise<GeminiAnalysis> => {
  // Vérification de la présence de la clé API
  const apiKey = process.env.API_KEY;
  if (!apiKey || apiKey === "undefined") {
    throw new Error("La clé API n'est pas configurée. Sur Vercel, assurez-vous d'avoir ajouté API_KEY dans 'Environment Variables'.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Échantillonnage intelligent pour l'IA (max 100 points pour la précision sans saturer)
  const sampleStep = Math.max(1, Math.floor(data.length / 100));
  const sampledData = data
    .filter((_, i) => i % sampleStep === 0)
    .slice(-100)
    .map(d => ({
      pk: d.pk?.toFixed(3),
      y: d.y.toFixed(2),
      z: d.z.toFixed(2)
    }));
  
  const userPrompt = `Analyse de la session d'inspection sur la Voie ${stats.track}.
Secteur: ${stats.line}
Train: ${stats.train} (${stats.engineNumber})

STATISTIQUES GLOBALES :
- Accélération Verticale Max: ${stats.maxVertical.toFixed(2)} m/s²
- Accélération Transversale Max: ${stats.maxTransversal.toFixed(2)} m/s²
- Dépassements seuils Y (ATC) : LA=${stats.countLA}, LI=${stats.countLI}, LAI=${stats.countLAI}
- Durée de mesure: ${stats.duration.toFixed(0)} secondes

DONNÉES BRUTES ÉCHANTILLONNÉES (PK, Y, Z) :
${JSON.stringify(sampledData)}

Effectue une expertise technique de la géométrie de la voie basée sur ces accélérations.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: userPrompt,
      config: {
        systemInstruction: `Tu es un ingénieur expert en maintenance de l'infrastructure ferroviaire à Grande Vitesse (LGV).
Ton rôle est d'analyser les accélérations enregistrées par un smartphone pour détecter des défauts de nivellement ou de dressage de la voie.
Seuils transversaux (Y) : LA (Alerte: ${stats.thresholdLA}), LI (Intervention: ${stats.thresholdLI}), LAI (Action Immédiate: ${stats.thresholdLAI}).

Règles de conformité :
- 'Conforme' : Aucune accélération > LI, peu de LA.
- 'Surveillance' : Présence de plusieurs points > LA ou quelques points > LI.
- 'Critique' : Tout point > LAI ou répétition fréquente de points > LI.

Fournis une réponse structurée en JSON uniquement.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            activityType: { type: Type.STRING, description: "Nature du mouvement prédominant (ex: Lacets, Chocs ponctuels, Roulis)" },
            intensityScore: { type: Type.NUMBER, description: "Score de confort/stabilité de 0 à 100" },
            observations: { 
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Points saillants de l'analyse technique"
            },
            recommendations: { type: Type.STRING, description: "Actions de maintenance préconisées" },
            complianceLevel: { 
              type: Type.STRING,
              enum: ["Conforme", "Surveillance", "Critique"]
            }
          },
          required: ["activityType", "intensityScore", "observations", "recommendations", "complianceLevel"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("Le modèle n'a pas retourné de texte.");
    
    return JSON.parse(text) as GeminiAnalysis;
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    throw new Error(error.message || "Erreur lors de la communication avec l'IA.");
  }
};
