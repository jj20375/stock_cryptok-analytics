import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch, type TypedUseSelectorHook, useSelector } from "react-redux";
import { i18nReducer } from "./i18nSlice";

const rootReducer = combineReducers({
    i18nStore: i18nReducer,
});

export const store = () => {
    return configureStore({
        reducer: rootReducer,
        middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
    });
};

export type AppStore = ReturnType<typeof store>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
