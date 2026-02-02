const app = {
    apiKey: localStorage.getItem('saygo_gemini_api_key') || '',
    location: {
        lat: null,
        lon: null,
        display: null
    },
    itineraryHistory: [], // Store previous results to avoid duplicates


    init() {
        this.bindEvents();
        this.checkApiKey();
        this.getLocation();
    },

    bindEvents() {
        // Auth UI
        document.getElementById('auth-btn').addEventListener('click', () => this.showModal());
        document.getElementById('close-modal-btn').addEventListener('click', () => this.hideModal());
        document.getElementById('save-key-btn').addEventListener('click', () => this.saveApiKey());
        document.getElementById('clear-key-btn').addEventListener('click', () => {
            if (confirm('確定要清除儲存的 API Key 嗎？')) {
                this.resetApiKey();
            }
        });
        // Location UI
        document.getElementById('refresh-loc-btn').addEventListener('click', () => this.getLocation());

        // Form Submission
        document.getElementById('travel-form').addEventListener('submit', (e) => this.handleGenerate(e));

        // Actions
        document.getElementById('regenerate-btn').addEventListener('click', (e) => this.handleGenerate(e));

        document.getElementById('download-btn').addEventListener('click', () => {
            this.downloadImage();
        });
    },

    downloadImage() {
        const target = document.getElementById('capture-target');
        const watermark = document.querySelector('.watermark');
        watermark.style.display = 'block'; // Show for capture

        html2canvas(target, {
            backgroundColor: '#ffffff',
            scale: 2 // High Resolution
        }).then(canvas => {
            watermark.style.display = 'none'; // Hide after

            // Create temporary link
            const link = document.createElement('a');
            link.download = `說走就走行程_${new Date().toISOString().slice(0, 10)}.jpg`;
            link.href = canvas.toDataURL('image/jpeg', 0.9);
            link.click();
        }).catch(err => {
            console.error('Screenshot failed:', err);
            alert('圖片下載失敗，請稍後再試。');
        });
    },


    checkApiKey() {
        if (!this.apiKey) {
            this.showModal();
        } else {
            console.log('API Key present');
        }
    },

    showModal() {
        document.getElementById('api-modal').classList.remove('hidden');
        document.getElementById('api-key-input').value = this.apiKey;
    },

    hideModal() {
        document.getElementById('api-modal').classList.add('hidden');
    },

    saveApiKey() {
        const input = document.getElementById('api-key-input').value.trim();
        if (input) {
            this.apiKey = input;
            localStorage.setItem('saygo_gemini_api_key', input);
            this.hideModal();
            alert('API Key 已儲存！');
        } else {
            alert('請輸入有效的 API Key');
        }
    },

    resetApiKey() {
        this.apiKey = '';
        localStorage.removeItem('saygo_gemini_api_key');
        this.showModal();
    },

    getLocation() {
        const locDisplay = document.getElementById('current-location');
        locDisplay.textContent = '正在定位中...';
        locDisplay.classList.add('loading');

        if (!navigator.geolocation) {
            locDisplay.textContent = '您的裝置不支援定位功能';
            locDisplay.classList.remove('loading');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                this.location.lat = position.coords.latitude;
                this.location.lon = position.coords.longitude;
                this.reverseGeocode(this.location.lat, this.location.lon);
            },
            (error) => {
                console.error('Location error:', error);
                locDisplay.textContent = '無法取得位置 (請允許權限)';
                locDisplay.classList.remove('loading');
            }
        );
    },

    async reverseGeocode(lat, lon) {
        const locDisplay = document.getElementById('current-location');
        try {
            // Using OpenStreetMap Nominatim API
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&accept-language=zh-TW`);
            const data = await response.json();

            // Extract meaningful address (City + Suburb/Town)
            const address = data.address;
            const city = address.city || address.county || '';
            const district = address.suburb || address.town || address.district || '';

            this.location.display = `${city}${district}`;
            locDisplay.textContent = this.location.display;
        } catch (error) {
            console.error('Reverse Geocoding error:', error);
            locDisplay.textContent = `座標: ${lat.toFixed(3)}, ${lon.toFixed(3)}`;
            this.location.display = `座標(${lat.toFixed(3)}, ${lon.toFixed(3)})`;
        } finally {
            locDisplay.classList.remove('loading');
        }
    },

    async handleGenerate(e) {
        e.preventDefault();

        if (!this.apiKey) {
            alert('請先設定 Google Gemini API Key！');
            this.showModal();
            return;
        }

        if (!this.location.display && !this.location.lat) {
            alert('無法取得您的位置，請檢查定位權限。');
            return;
        }

        // Gather Inputs
        const transport = document.getElementById('transport').value;
        const startTime = document.getElementById('start-time').value;
        const endTime = document.getElementById('end-time').value;
        const preferences = document.getElementById('preferences').value;
        const companions = document.getElementById('companions').value || '無';
        const locationName = this.location.display || `座標 ${this.location.lat}, ${this.location.lon}`;

        // UI Loading
        const resultSection = document.getElementById('result-area');
        const resultContent = document.getElementById('result-content');
        const loading = document.getElementById('loading-indicator');
        const submitBtn = document.querySelector('.cta-button');

        resultSection.classList.remove('hidden');
        loading.classList.remove('hidden');
        resultContent.innerHTML = ''; // Clear previous
        submitBtn.disabled = true;
        submitBtn.disabled = true;
        // submitBtn.textContent = '規劃中...'; // Moved to updateLoadingStatus

        // Construct Prompt
        const historyContext = this.itineraryHistory.slice(-3).map(h => `(已產生的行程，請避開這些內容: ${h})`).join('\n');

        const prompt = `
你是一個專業的在地旅遊嚮導。請為我規劃一個「一日遊行程」。

【基本資訊】
目前位置：${locationName}
行程範圍：嚴格限制在「${this.location.display || '該行政區'}」範圍內。（除非該區真的無處可去，才允許稍微擴展到緊鄰的區域）。
移動方式：${transport}
時間安排：${startTime} 到 ${endTime}
旅遊喜好：${preferences}
輔助資訊（同行者）：${companions}

【必須遵守的規則】
1. **絕對真實性 (最高優先)**：
   - **強制 Google 搜尋驗證**：在決定任何一個地點之前，**你必須先使用 Google Search 工具搜尋該地點**。
   - **以搜尋結果為準**：
     - 如果搜尋結果顯示該店「永久停業」或「查無此地」，**絕對不能列入**。
     - 如果搜尋結果顯示的地址與你記憶中不同，**請以搜尋結果的地址為準**。
     - **名稱精確度**：請使用 Google Map 上顯示的準確名稱。
   - **初步檢核**：請盡量只列出你確定存在的地點。稍後會會有查核員進行二次檢查，但請不要給出太離譜的初稿。
   - **餐飲特別檢核**：推薦餐廳時，**務必確認該餐廳是否仍在營業**。若搜尋結果顯示「永久停業」或超過一年沒評論，請避開。
   - **嚴禁捏造連鎖店**：再次強調，Global Mall 環球購物中心中和店裡面**沒有誠品**。不要亂編。
   - **反向查證**：請自問「我在 Google 上搜得到這個名字加這個地址嗎？」。
   - **地址與連結**：每個地點**必須附上真實地址**，並且**附上 Google Maps 搜尋連結** (格式: [Google Maps](https://www.google.com/maps/search/?api=1&query=地點名稱))，方便使用者直接導航。
            2. ** 行程節奏與交通緩衝(重要) **：
   - ** 請勿將行程排得太密 **。
   - ** 嚴格計算移動時間(必須加入緩衝) **：
     - ** 開車 / 騎車 **：Google Maps 的預估行車時間 + ** 20分鐘 ** (找車位 + 步行)。
     - ** 大眾運輸 **：乘車時間 + ** 15分鐘 ** (等車 + 步行)。
     - ** 走路 **：實際步行時間 + ** 10分鐘 ** (休息 / 紅綠燈)。
        - 請在「交通移動」欄位中明確寫出這些時間計算(例如：開車 20分 + 找車位 15分 = 約 35 分鐘)。
        3. ** 交通現實感 **：不能讓使用者瞬間移動。請精確計算點對點的距離與時間。
        4. ** 避免重複 **：${historyContext ? '請不要與以下已經產生過的行程重複：\n' + historyContext : '請給出最經典的安排。'}
        5. ** 標題 **：請為這個行程取一個充滿吸引力、有趣的標題。
        6. ** 嚴格限制 **：** 不要 ** 輸出任何系統分析文字，** 不要 ** 輸出你的思考過程，直接輸出最終的建議行程。

【輸出格式(Markdown)】
#[你的創意標題]

### 📍[時間][景點名稱]
    *   ** 地址 **：[真實完整地址]([開啟 Google Maps](https://www.google.com/maps/search/?api=1&query=[景點名稱]))
*   ** 特色 **：[簡短介紹]
    *   ** 建議停留 **：[時間]
    *   ** 交通移動 **：(由此前往下一站預計 ${transport} 時間：約 XX 分鐘，含緩衝)

        (依此類推...請確保最後結束時間不超過 ${endTime})
        `;

        try {
            // Stage 1: Draft Generation
            this.updateLoadingStatus('正在規劃初版行程... (1/2)');
            const draftResult = await this.callGeminiApi(prompt);

            // Stage 2: Verification (Reflexion)
            this.updateLoadingStatus('正在嚴格檢查地點真實性... (2/2)');
            const finalResult = await this.verifyItinerary(draftResult, locationName);

            // Save to history (keep max 5)
            this.itineraryHistory.push(finalResult.substring(0, 100));

            resultContent.innerHTML = marked.parse(finalResult);

            // Show Action Buttons
            document.getElementById('result-actions').classList.remove('hidden');

        } catch (error) {
            console.error('API Error:', error);
            resultContent.innerHTML = `
        < div class= "error-box" >
                    <p style="color:red; font-weight:bold;">發生錯誤：${error.message}</p>
                    <p>請檢查您的 API Key 或是網路連線。</p>
                    <button onclick="app.resetApiKey()" class="secondary-btn" style="margin-top:10px;">重新設定 API Key</button>
                </div >
        `;
        } finally {
            loading.classList.add('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = '旅 遊 吧 ! 🎒';
            // Scroll to result
            resultSection.scrollIntoView({ behavior: 'smooth' });
        }
    },

    updateLoadingStatus(msg) {
        const loadingText = document.querySelector('#loading-indicator p');
        const submitBtn = document.querySelector('.cta-button');
        if (loadingText) loadingText.textContent = msg;
        if (submitBtn) submitBtn.textContent = msg;
    },

    async verifyItinerary(draftContent, userLocation) {
        const verificationPrompt = `
你是一位嚴格的「行程查核員」。請檢查以下這份旅遊行程，並進行修正。
使用者的位置在：${userLocation}

【待檢查的行程】
${draftContent}

【你的任務】
1. **逐一檢查地點**：請使用 Google Search 搜尋行程中每個地點的「店名」與「地址」。
2. **修正錯誤**：
   - **地址錯誤**：如果搜尋出來的地址跟行程寫的不一樣，請**直接修正為搜尋到的正確地址**。
   - **店名錯誤**：如果該地址其實是別家店（例如：其實是「國立臺灣圖書館」而不是「中和分館」），請**即刻修正店名**。
   - **店家不存在/歇業**：如果搜尋結果顯示「永久停業」或根本找不到，請**直接刪除該行程點**，並補上一個附近同性質的真實景點。
   - **連鎖店檢查**：確認該地點真的有那家連鎖店嗎？如果沒有（例如 Global Mall 沒有誠品），請換成該商場真實存在的其他店。
3. **保持格式**：請保持原本的 Markdown 格式輸出，不要像我解釋你改了什麼，**直接給我一份修正後、完美的行程表**。
4. **補上連結**：確保修正後的每個地點都有附上 [Google Maps] 連結。

請開始工作，給我最終版本的行程。
`;
        console.log('Starting Verification Phase...');
        return await this.callGeminiApi(verificationPrompt);
    },

    async callGeminiApi(prompt) {
        // 1. 嘗試自動偵測可用模型 (解決 "Model Not Found" 問題)
        let validModel = await this.findValidModel();

        if (!validModel) {
            // 如果偵測不到，再嘗試最後的寫死清單
            console.warn('ListModels failed or empty, using fallback list.');
            return await this.fallbackTryModels(prompt);
        }

        console.log(`Using auto - detected model: ${validModel}`);
        return await this.tryModel(validModel, prompt);
    },

    async findValidModel() {
        try {
            const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`;
            const response = await fetch(listUrl);
            const data = await response.json();

            if (!data.models) return null;

            // 尋找支援 generateContent 的模型
            const modelObj = data.models.find(m =>
                m.supportedGenerationMethods &&
                m.supportedGenerationMethods.includes('generateContent') &&
                (m.name.includes('gemini') || m.name.includes('flash') || m.name.includes('pro'))
            );

            if (modelObj) {
                // API 回傳的 name 格式為 "models/gemini-pro"，我們只需要 "gemini-pro"
                return modelObj.name.replace('models/', '');
            }
        } catch (e) {
            console.error('Auto-detect model failed:', e);
        }
        return null;
    },

    async fallbackTryModels(prompt) {
        // 優先嘗試支援搜尋的新版模型 - 將 Pro 移至第一位以追求最高準確度
        const models = [
            'gemini-1.5-pro-002',   // 最聰明，推理能力最強
            'gemini-1.5-flash-002', // 次之，速度快
            'gemini-1.5-pro',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b'
        ];

        let lastError = null;

        for (const model of models) {
            try {
                console.log(`Fallback trying: ${model}...`);
                return await this.tryModel(model, prompt);
            } catch (error) {
                lastError = error;
            }
        }
        throw new Error(`所有模型皆不可用。最後錯誤: ${lastError?.message}`);
    },

    async tryModel(modelName, prompt) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }],
            // 關鍵：啟用 Google 搜尋接地功能 (Grounding)
            // 這強迫 AI 去搜尋 Google 以確認地點真實性
            tools: [
                { google_search: {} }
            ]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            const errorMsg = data.error?.message || response.statusText;
            throw new Error(`[${modelName}] ${errorMsg}`);
        }

        if (data.candidates && data.candidates[0].content) {
            return data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('AI 無法生成內容（回傳格式不如預期）。');
        }
    }
};

// Start App
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
