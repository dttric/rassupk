import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";

// Native fetch is available in Node 18+ which matches our runtime env
const SIBUPK_URL = "http://old.sibupk.su/services/shedule_new/index.php?mode=1";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // API router to fetch schedules & options
  app.post("/api/schedule", async (req, res) => {
    try {
      const { id_Forma, id_Fak, Kurs, NamePodGrup, RangeNedel } = req.body;

      // Construct URL-encoded form parameters
      const params = new URLSearchParams();
      if (id_Forma) params.append("id_Forma", String(id_Forma));
      if (id_Fak) params.append("id_Fak", String(id_Fak));
      if (Kurs) params.append("Kurs", String(Kurs));
      if (NamePodGrup) params.append("NamePodGrup", String(NamePodGrup));
      if (RangeNedel) params.append("RangeNedel", String(RangeNedel));

      let responseText = "";
      try {
        const fetchRes = await fetch(SIBUPK_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          body: params.toString(),
          signal: AbortSignal.timeout(12000)
        });
        
        if (!fetchRes.ok) {
          throw new Error(`Server returned status ${fetchRes.status}`);
        }
        responseText = await fetchRes.text();
      } catch (err: any) {
        console.error("Fetch network error:", err.message);
        return res.status(502).json({
          error: "Не удалось подключиться к сайту СибУПК. Пожалуйста, попробуйте позже.",
          details: err.message
        });
      }

      const $ = cheerio.load(responseText);

      // Helper to extract dropdown options
      const extractOptions = (selectName: string) => {
        const options: { value: string; label: string }[] = [];
        $(`select[name="${selectName}"] option`).each((_, el) => {
          const val = $(el).attr("value");
          const label = $(el).text().trim();
          if (val !== undefined && val !== "") {
            options.push({ value: val, label });
          }
        });
        return options;
      };

      // Extract whatever options are currently active in this step's HTML response
      const forms = extractOptions("id_Forma");
      const faculties = extractOptions("id_Fak");
      const courses = extractOptions("Kurs");
      const groups = extractOptions("NamePodGrup");
      const weeks = extractOptions("RangeNedel");

      // Parse schedule table if present
      const schedule: any[] = [];
      let currentDay = "";
      let currentDate = "";
      let currentWeekType = "";

      const scheduleTable = $("table").filter((_, el) => {
        const text = $(el).text();
        return text.includes("№ Пары") && text.includes("Дисциплина");
      });

      if (scheduleTable.length > 0) {
        scheduleTable.find("tr").each((_, row) => {
          const ths = $(row).find("th");
          const tds = $(row).find("td");

          if (ths.length > 0) {
            const thText = ths.text().trim();
            if (thText.includes("НЕДЕЛЯ")) {
              currentWeekType = thText.replace(/\s+/g, " ");
            } else {
              // Parse Day and Date, e.g., "Понедельник (08.06.2026)"
              const match = thText.match(/([А-Яа-яA-Za-z]+)\s*\((\d{2}\.\d{2}\.\d{4})\)/);
              if (match) {
                currentDay = match[1];
                currentDate = match[2];
              } else {
                currentDay = thText;
                currentDate = "";
              }
            }
          } else if (tds.length === 5) {
            const lessonText = $(tds[0]).text().trim();
            const subject = $(tds[1]).text().trim();
            const stream = $(tds[2]).text().trim();
            const classroom = $(tds[3]).text().trim();
            const teacher = $(tds[4]).text().trim();

            const lessonMatch = lessonText.match(/^(\d+)\s*\((.*)\)$/);
            const lessonNumber = lessonMatch ? parseInt(lessonMatch[1], 10) : lessonText;
            const lessonTime = lessonMatch ? lessonMatch[2] : "";

            schedule.push({
              weekType: currentWeekType,
              dayName: currentDay,
              date: currentDate,
              lessonNumber,
              time: lessonTime,
              subject,
              stream,
              classroom,
              teacher,
            });
          }
        });
      }

      // Return options, current selections, and parsed schedule (if loaded)
      res.json({
        success: true,
        options: {
          forms,
          faculties,
          courses,
          groups,
          weeks,
        },
        schedule,
        debug: {
          receivedParams: { id_Forma, id_Fak, Kurs, NamePodGrup, RangeNedel },
          hasTable: scheduleTable.length > 0,
          scheduleLength: schedule.length
        }
      });
    } catch (error: any) {
      console.error("Backend proxy error:", error);
      res.status(500).json({
        error: "Произошла внутренняя ошибка сервера при обработке расписания.",
        details: error.message,
      });
    }
  });

  // Serve Vite frontend
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

startServer();
