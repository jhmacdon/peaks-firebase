import * as functions from 'firebase-functions'
const destinationHelpers = require('./destinationHelpers')
import * as request from "request-promise-native";
import { WeatherResponse, DailyWeatherForecast } from "./weatherTypes";
import * as firAdmin from 'firebase-admin'
import DocumentSnapshot = firAdmin.firestore.DocumentSnapshot
import CollectionReference = firAdmin.firestore.CollectionReference
import DocumentReference = firAdmin.firestore.DocumentReference
const firebase = require('./firebase')
const admin = firebase.admin
const firestore = admin.firestore()


exports.weatherForDestination = functions.https.onCall(async (data, context) => {
    const destinationId = data.destinationId as string
    const weather = (await destinationHelpers.getDestinationWeather(destinationId)) as DocumentSnapshot

    if (weather) {
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - 4);
        const weatherData = weather.data()
        if (weatherData && weatherData.lastUpdated.toDate() > cutoff) {
            weatherData.lastUpdated = weatherData.lastUpdated.toDate().toISOString()
            const cachedResponse: WeatherResponse = weatherData as WeatherResponse
            console.log("Using cached response")
            return cachedResponse
        }
    }

    const destination = await destinationHelpers.getDestination(destinationId) as DocumentSnapshot

    const lat = destination.data()!.l[0]
    const lng = destination.data()!.l[1]
    const weatherApiKey = functions.config().weatherbit.api_key
    const forecastURL = `https://api.weatherbit.io/v2.0/forecast/daily?lat=${lat}&lon=${lng}&units=S&key=${weatherApiKey}`
    const currentURL = `https://api.weatherbit.io/v2.0/current?lat=${lat}&lon=${lng}&units=S&key=${weatherApiKey}`
    const forecastResponse = await request.get(forecastURL, {json: true})
    const currentResponse = await request.get(currentURL, {json: true}) // parallelize 
    

    const forecasts: DailyWeatherForecast[] = []

    forecastResponse.data.forEach(result => {
        const dayForecast: DailyWeatherForecast = {
            temperatureMax: result.high_temp,
            temperatureMin: result.low_temp,
            id: result.weather.code,
            clouds: result.clouds,
            wind: {
                speed: result.wind_spd,
                direction: result.wind_dir,
                gust: result.wind_gust_spd
            },
            visibility: result.vis,
            date: new Date(result.ts * 1000).toISOString(),
            timezone: forecastResponse.timezone,
            snow: result.snow,
            rain: result.precip
        }
        forecasts.push(dayForecast)
    })

    const response: WeatherResponse = {
        destinationId: destinationId,
        current: {
            temperature: currentResponse.data[0].temp,
            id: currentResponse.data[0].weather.code,
            clouds: currentResponse.data[0].clouds,
            wind: {
                speed: currentResponse.data[0].wind_spd,
                direction: currentResponse.data[0].wind_dir
            },
            visibility: currentResponse.data[0].vis
        },
        forecast: forecasts,
        history: [],
        lastUpdated: new Date().toISOString()
    }

    let docRef: DocumentReference

    if (weather) {
        docRef = weather.ref
    } else {
        const weatherCollection: CollectionReference = firestore.collection("weather") 
        docRef = weatherCollection.doc()
    }

    const responseToCache = response as any
    responseToCache.lastUpdated = new Date()

    await docRef.set(responseToCache)

    response.lastUpdated = new Date().toISOString()

    /* This code uses Open Weather Map
    result.daily.forEach(forecastResult => {
        const dayForecast: DailyWeatherForecast = {
            temperatureMax: forecastResult.temp.max,
            temperatureMin: forecastResult.temp.min,
            id: forecastResult.weather[0].id,
            clouds: forecastResult.clouds,
            wind: {
                speed: forecastResult.wind_speed,
                direction: forecastResult.wind_deg,
                gust: forecastResult.wind_gust
            },
            visibility: forecastResult.visibility,
            date: new Date(forecastResult.dt * 1000).toISOString(),
            timezone: result.timezone,
            snow: forecastResult.snow,
            rain: forecastResult.rain
        }
        forecasts.push(dayForecast)
    });
    
    console.log(forecasts[4])

    const response: WeatherResponse = {
        destinationId: destinationId,
        current: {
            temperature: result.current.temp,
            id: result.current.weather[0].id,
            clouds: result.current.clouds,
            wind: {
                speed: result.current.wind_speed,
                direction: result.current.wind_deg,
                gust: result.current.wind_gust
            },
            visibility: result.current.visibility
        },
        forecast: forecasts,
        history: [],
        lastUpdated: new Date().toISOString()
    }
    */
    
    return response
  })
