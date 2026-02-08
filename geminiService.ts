
import { GoogleGenAI, Type } from "@google/genai";
import { AccelerationData, GeminiAnalysis, SessionStats } from "../types";

export const analyzeMotionSession = async (data: AccelerationData[], stats: SessionStats): Promise<GeminiAnalysis> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Clé API manquante.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Échantillonnage pour l'IA (focus sur les événements significatifs)
  const peaks = data
    .filter(d => Math.abs(d.y) > stats.thresholdLA || Math.abs(d.z) > stats.thresholdLA)
    .slice(-50);
    
  const regularSample = data
    .filter((_, i) => i % Math.max(1, Math.floor(data.length / 50)) === 0)
    .slice(-50);

  const mergedData = [...peaks, ...regularSample]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(d => ({
      pk: d.pk?.toFixed(4),
      y: d.y.toFixed(3), // Transversal (ATC)
      z: d.z.toFixed(3)  // Vertical (AVC)
    }));
  
  const userPrompt = `Analyse expert infrastructure ferroviaire (LGV).
Contexte: Ligne ${stats.line}, Voie ${stats.track}, Train ${stats.train}.
Sens PK: ${stats.direction}.

STATISTIQUES:
- Max AVC (Vertical γz): ${stats.maxVertical.toFixed(2)} m/s²
- Max ATC (Transversal γy): ${stats.maxTransversal.toFixed(2)} m/s²
- Dépassements seuils ATC: LA=${stats.countLA}, LI=${stats.countLI}, LAI=${stats.countLAI}

DONNÉES (PK, γy_ATC, γz_AVC):
${JSON.stringify(mergedData)}

Analyse la qualité de la voie (nivellement AVC et dressage ATC). Identifie les PK suspects.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: userPrompt,
      config: {
        systemInstruction: `Tu es un ingénieur expert en maintenance des voies ferrées (Infra).
Ton diagnostic doit être précis sur les défauts de nivellement (AVC - accélérations verticales Z) et de dressage (ATC - accélérations transversales Y).
Seuils transversaux ATC (Y): LA=${stats.thresholdLA}, LI=${stats.thresholdLI}, LAI=${stats.thresholdLAI}.
Action requise si > LAI en ATC: "Action immédiate, limitation de vitesse ou protection".
Réponds en JSON uniquement.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            activityType: { type: Type.STRING },
            intensityScore: { type: Type.NUMBER },
            observations: { type: Type.ARRAY, items: { type: Type.STRING } },
            recommendations: { type: Type.STRING },
            complianceLevel: { type: Type.STRING, enum: ["Conforme", "Surveillance", "Critique"] },
            anomalousPKs: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Liste des PK où des anomalies ont été détectées" }
          },
          required: ["activityType", "intensityScore", "observations", "recommendations", "complianceLevel", "anomalousPKs"]
        }
      }
    });

    return JSON.parse(response.text) as GeminiAnalysis;
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    throw new Error(error.message || "Erreur analyse IA");
  }
};
