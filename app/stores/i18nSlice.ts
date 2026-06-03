import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

const initialState: any = {
    lang: "zh-TW"
};

/** i18n store */
export const i18nSlice = createSlice({
    name: "i18nStore",
    initialState,
    reducers: {
        /**
         * 設定語言
         * @param state
         * @param action
         */
        setLang: (state: any, action: PayloadAction<any>) => {
            state.lang = action.payload;
        }
    }
});

/** i18n store actions */
export const { setLang } = i18nSlice.actions;
/** i18n store */
export const i18nReducer = i18nSlice.reducer;
