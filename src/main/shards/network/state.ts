import { DEFAULT_HTTP_PROXY_SETTING } from '@shared/shards/network'
import { makeAutoObservable, observableRef } from 'mobx'

export class NetworkSettings {
  httpProxy = { ...DEFAULT_HTTP_PROXY_SETTING }

  constructor() {
    makeAutoObservable(this, { httpProxy: observableRef })
  }
}
