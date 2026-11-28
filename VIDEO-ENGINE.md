# Ibrahim Studio VideoEngine

محرك فيديو مستقل يعمل داخل المتصفح باستخدام FFmpeg.wasm. لا يرسل ملف الفيديو إلى خادم.

## الملفات

- `assets/js/video-engine.js`: كلاس المحرك `VideoEngine`.
- `video-engine-demo.html`: واجهة تجريبية كاملة للاختبار.
- `assets/ffmpeg/worker.js`: عامل FFmpeg المحلي المستخدم من قبل المحرك.
- `assets/ffmpeg/const.js`: إعدادات Core الافتراضية.

## الإصدارات المثبتة

- `@ffmpeg/ffmpeg@0.12.15`
- `@ffmpeg/util@0.12.2` (المحرك لا يحتاج استيراد util؛ يقرأ File مباشرة)
- `@ffmpeg/core@0.12.10`
- `@ffmpeg/core-mt@0.12.10`

هذه أرقام أحدث إصدارات npm المستقرة التي تم التحقق منها عند إعداد الملف. رقم إصدار حزمة FFmpeg.wasm ليس هو رقم إصدار مشروع FFmpeg الأصلي.

## التجربة

بعد نشر الموقع افتح:

`/video-engine-demo.html`

اختر فيديو ثم اضغط **فحص الفيديو**. بعد ظهور المعلومات اختر MAX أو CLASSIC أو COMPRESS ثم ابدأ المعالجة.

## الاستخدام داخل صفحة أخرى

```js
import { VideoEngine } from "./assets/js/video-engine.js";

const engine = new VideoEngine({
  preferMultiThread: true,
  onProgress: (progress, details) => {
    console.log(Math.round(progress * 100) + "%", details);
  },
  onLog: (line) => console.log(line),
  onStatus: (message) => console.info(message)
});

const file = document.querySelector('input[type="file"]').files[0];
const capabilities = engine.getCapabilities();
console.log(capabilities);

await engine.load();
const metadata = await engine.inspect(file);

const result = await engine.process(file, {
  mode: "MAX", // "CLASSIC" | "MAX" | "COMPRESS"
  metadata
});

engine.download(result);

// عند مغادرة الصفحة:
// engine.destroy();
```

### إلغاء العملية

```js
engine.cancel();
```

الإلغاء ينهي عامل FFmpeg الحالي؛ سيُعاد تحميل المحرك تلقائياً عند استدعاء `process()` مرة أخرى.

### سجل FFmpeg

```js
const fullLog = engine.getLog();
console.log(fullLog);
```

## الأوضاع

### CLASSIC
ينسخ أول مسار فيديو وأول مسار صوت إن وُجد باستخدام `-c copy`. لا يعيد ترميز الفيديو، ولذلك لا يخفض جودة مسارات الفيديو والصوت. لا يضمن أن كل تركيبات الترميز والحاوية متوافقة مع MP4؛ لهذا يحافظ على امتداد الحاوية الأصلية.

### MAX
ينسخ جميع المسارات المتاحة والبيانات الوصفية والفصول باستخدام `-map 0 -c copy`. هذا هو الخيار الأنسب للحفاظ على HEVC/HDR كما هو عندما يكون المطلوب عدم إعادة الترميز. لا يقوم بتحسين الصورة أو زيادة جودتها؛ إنه يحافظ على المصدر قدر الإمكان.

### COMPRESS
يعيد الترميز إلى MP4. الإعدادات:
- `codec`: `libx264` أو `libx265` إذا كان encoder موجوداً في ملف Core.
- `crf`: من 16 إلى 30. القيمة الأقل تعطي جودة أعلى وحجماً أكبر غالباً.
- `preset`: من ultrafast إلى slow. الأبطأ قد يعطي حجماً أفضل مقابل الجودة لكنه يحتاج وقتاً أطول.
- `audioBitrate`: 96k أو 128k أو 160k أو 192k أو 256k.

مثال:

```js
const result = await engine.process(file, {
  mode: "COMPRESS",
  codec: "libx264",
  crf: 22,
  preset: "fast",
  audioBitrate: "160k",
  metadata
});
```

تنبيه HDR: إعداد الضغط الافتراضي H.264 مع `yuv420p` قد لا يحافظ على HDR. استخدم MAX لنسخ المصدر دون إعادة ترميز. وجود خيار libx265 في الواجهة لا يعني أن encoder موجود في كل Core؛ المحرك يفحص قائمة encoders ويعطي خطأ واضحاً إذا لم يكن متاحاً.

## Multi-thread و Single-thread

يستخدم Multi-thread فقط عندما تكون الصفحة آمنة وتتوفر:
- `SharedArrayBuffer`
- `crossOriginIsolated === true`
- Web Workers وWebAssembly

إذا كانت المتطلبات غير متوفرة أو فشل تحميل Core متعدد الخيوط، ينتقل المحرك إلى Single-thread تلقائياً.

لتمكين Multi-thread على استضافة ثابتة، تحتاج عادة إلى ترويسات COOP/COEP المناسبة. لا تضفها إلى الموقع بالكامل قبل اختبار موارد الطرف الثالث؛ قد تمنع موارد خارجية لا تسمح بالتضمين عبر CORS/CORP.

## التقدم والإلغاء

المحرك يقرأ زمن التنفيذ من سجل FFmpeg ويستخدم حدث progress كإشارة مساعدة. حدث progress في FFmpeg.wasm موصوف بأنه تجريبي وقد لا يكون دقيقاً في كل أنواع المعالجة، خصوصاً النسخ أو المهام التي تختلف فيها مدة الإدخال والناتج. لذلك لا تعتبر النسبة تقديراً زمنياً مضموناً.

## أداء الجوال

- ابدأ بمقاطع قصيرة وصغيرة لاختبار الجهاز.
- تجنب فتح تطبيقات كثيرة أثناء الضغط.
- استخدم CLASSIC أو MAX عندما تريد الحفاظ على الترميز وتجنب تكلفة إعادة الترميز.
- استخدم preset fast أو veryfast على الهاتف.
- لا تشغّل أكثر من عملية في الوقت نفسه.
- اترك المتصفح مفتوحاً والشاشة نشطة أثناء المعالجة.
- Safari وChrome يختلفان في الذاكرة والعمال؛ لا توجد ضمانة أن كل ملف كبير سيعمل على كل هاتف.
- FFmpeg.wasm يستهلك ذاكرة إضافية عند قراءة الملف وكتابة الناتج؛ حد WebAssembly والذاكرة المتاحة يختلفان حسب البيئة.

## حدود مهمة

- المحرك محلي؛ ملفات الفيديو لا تُرفع إلى Render أو أي API.
- تحميل ملفات Core لأول مرة يحتاج اتصال إنترنت؛ بعد ذلك يحاول حفظ الملفات في Cache Storage، لكن المتصفح قد يمسحها.
- هذا المحرك لا يضمن منع TikTok من إعادة ضغط الفيديو بعد رفعه.
- لا يضمن أن الضغط سيجعل كل ملف أصغر؛ يعتمد الناتج على المصدر والإعدادات.
- دعم الترميزات يتحدد بما بُني داخل Core، وليس بمجرد وجود اسم الترميز في قائمة الاختيار.
