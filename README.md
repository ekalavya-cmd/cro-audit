# CRO Audit Framework

The CRO Audit evaluates websites for Conversion Rate Optimization across two specialized modes: **SEO** and **UX/UI**. Each mode runs targeted engines and returns a score with actionable quick wins.

## 🚀 Overview

- **SEO Mode**: Technical performance + navigation analysis
- **UX/UI Mode**: Visual clarity + conversion flow + mobile experience + trust + accessibility
- **Full Mode**: Both SEO and UX/UI analysis

## 🛠 Technology Stack

- **Node.js** & **TypeScript**
- **Express.js** (API Framework)
- **Lighthouse** (Performance & Accessibility)
- **Puppeteer** (DOM Analysis & Screenshots)
- **OpenAI GPT-4o** (Visual Heuristics)
- **axe-core** (Accessibility Violations)

## 📋 Prerequisites

- **Node.js** (v18+)
- **Google Chrome** or **Chromium**

## ⚙️ Setup

```bash
npm install
cp .env.example .env
```

## 🚀 Running the App

```bash
npm run dev
```

## 🖼️ Iframe Embed

### Basic Embed

```html
<iframe src="https://your-domain.com/" width="100%" height="700" frameborder="0"></iframe>
```

### With Company Blog Configuration

To display company-specific blogs in the iframe, use the `ref` query parameter:

```html
<iframe src="http://localhost:5000?ref=medgrowthengine.ai" title="" height="700px" width="600px">
</iframe>
```

Available company domains:

- `zealousweb.com` - Displays ZealousWeb blogs and contact page
- `medgrowthengine.ai` - Displays MedGrowth Engine blogs and contact page

### Blog Configuration

Edit `src/static/domain-blogs.json` to configure blogs for each company:

```json
{
  "domain.com": {
    "blogs": [
      {
        "title": "Blog Title",
        "url": "https://domain.com/blog/post",
        "image": "cv1",
        "category": "Case Study",
        "description": "Short description..."
      }
    ],
    "contactUrl": "https://domain.com/contact/"
  }
}
```

Image options:

- `cv1`, `cv2`, `cv3` - Built-in canvas gradients
- External URLs (if hosting site CSP allows)

## 📡 API Documentation

### Run Website Audit

- **Backend Endpoint:** `POST /api/audit/run`
- **Frontend URL:** `http://localhost:5000`

- **Request Body:**
  ```json
  {
    "url": "https://example.com",
    "mode": "seo",
    "notifyViaEmail": false,
    "email": "user@example.com"
  }
  ```

| Field            | Required | Description                                            |
| ---------------- | -------- | ------------------------------------------------------ |
| `url`            | Yes      | Target website URL                                     |
| `mode`           | No       | Audit mode: `seo`, `uxui`, or `full` (default: `full`) |
| `notifyViaEmail` | No       | Send report via email                                  |
| `email`          | No       | Email address for report delivery                      |

### Response — SEO Audit Mode

```json
{
  "auditMode": "seo",
  "seoScore": 79,
  "grade": "B+",
  "label": "Good",
  "message": "Solid foundation with some technical gaps worth addressing.",
  "breakdown": {
    "performance": { "score": 78, "weight": 0.6, "contribution": 46.8 },
    "navigation": { "score": 80, "weight": 0.4, "contribution": 32.0 }
  },
  "performanceDetail": {
    "lighthouseScore": 72,
    "lcp": "3.2s",
    "cls": 0.08,
    "tti": "4.1s"
  },
  "navigationDetail": {
    "brokenLinks": 3,
    "menuItems": 9,
    "avgClickDepth": 2.8,
    "orphanPages": 0
  },
  "quickWins": [
    { "issue": "Multiple broken links...", "impact": "medium" },
    { "issue": "Navigation menu exceeds 7 items...", "impact": "low" }
  ],
  "criticalIssueCount": 1
}
```

### Response — UX/UI Audit Mode

```json
{
  "auditMode": "uxui",
  "uxuiScore": 65,
  "grade": "B- / C+",
  "label": "Average",
  "message": "Friction in your user experience is likely costing you leads and sales.",
  "breakdown": {
    "visualClarity": { "score": 71, "weight": 0.2667, "contribution": 18.94 },
    "conversionFlow": { "score": 60, "weight": 0.2667, "contribution": 16.0 },
    "mobileExperience": { "score": 58, "weight": 0.2, "contribution": 11.6 },
    "trustCredibility": { "score": 60, "weight": 0.1333, "contribution": 8.0 },
    "accessibility": { "score": 76, "weight": 0.1333, "contribution": 10.13 }
  },
  "aiRatings": {
    "value_proposition_clarity": 7,
    "cta_visibility": 8,
    "above_fold_clarity": 6,
    "whitespace_balance": 7,
    "design_consistency": 8,
    "typography_variation": 6,
    "cta_placement_quality": 7,
    "trust_visual_signals": 5
  },
  "quickWins": [
    { "issue": "Contact form has too many fields...", "impact": "high" },
    { "issue": "Mobile usability issues detected...", "impact": "high" },
    { "issue": "Primary CTA is not prominent enough...", "impact": "high" }
  ],
  "criticalIssueCount": 3
}
```

## 🧠 Engine Architecture & Data Flow

### Input

- `url`: Target website URL
- `mode`: `"seo"` or `"uxui"`
- `notifyViaEmail`: `true` or `false`
- `email`: Email address for report delivery

### Flow by Mode

**SEO Mode**

1. **Lighthouse Engine** → Desktop performance + accessibility + Core Web Vitals (LCP, CLS, TTI)
2. **DOM Engine** → Broken links, navigation structure, HTTPS, trust signals
3. **Score Calculator** → `seoScore = (performance × 0.60) + (navigation × 0.40)`

**UX/UI Mode**

1. **Lighthouse Engine** → Mobile performance + accessibility
2. **DOM Engine** → CTA, forms, trust signals, structure
3. **Axe Engine** → Accessibility violations (critical, serious, moderate, minor)
4. **Visual Engine** → Desktop + mobile screenshots → GPT-4o AI ratings
5. **Score Calculator** → `uxuiScore = (visualClarity × 0.2667) + (conversionFlow × 0.2667) + (mobileExperience × 0.2000) + (trustCredibility × 0.1333) + (accessibility × 0.1333)`

**Full Mode**

1. **Lighthouse Engine** → Desktop + mobile performance + accessibility + Core Web Vitals (LCP, CLS, TTI)
2. **DOM Engine** → Broken links, navigation structure, HTTPS, trust signals
3. **Axe Engine** → Accessibility violations (critical, serious, moderate, minor)
4. **Visual Engine** → Desktop + mobile screenshots → GPT-4o AI ratings
5. **Score Calculator**

### Output

- JSON response with score, grade, breakdown, AI ratings (UX/UI), performance/navigation details (SEO), quick wins, and critical issue count

## 📝 License

This project is proprietary.
