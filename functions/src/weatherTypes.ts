export interface WeatherResponse {
    destinationId: string
    current: CurrentWeather
    forecast: DailyWeatherForecast[]
    history: string[]
    lastUpdated: string
}

export interface CurrentWeather {
    temperature: number
    id: number
    clouds: number
    wind: Wind
    visibility: number
}

export interface DailyWeatherForecast {
    temperatureMax: number
    temperatureMin: number
    id: number
    clouds: number
    wind: Wind
    visibility: number
    date: string
    timezone: string
    snow: number
    rain: number
}

export interface DailyWeatherHistory {
    temperatureMax: number
    temperatureMin: number
    id: number
    clouds: number
    wind: Wind
    visibility: number
    date: string
    timezone: string
    snow: number
    rain: number
}

export interface Wind {
    speed: number,
    direction: number
    gust?: number
}