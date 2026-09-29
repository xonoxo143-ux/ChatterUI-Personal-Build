package com.agentworkspace.runtime

import android.app.Service
import android.content.Intent
import android.os.IBinder

class TermuxResultService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val requestCode = intent?.getIntExtra(EXTRA_REQUEST_CODE, -1) ?: -1
        if (requestCode >= 0) {
            val result = intent?.getBundleExtra(TermuxCommandBroker.EXTRA_PLUGIN_RESULT_BUNDLE)
            TermuxCommandBroker.complete(requestCode, result)
        }

        stopSelf(startId)
        return START_NOT_STICKY
    }

    companion object {
        const val EXTRA_REQUEST_CODE = "com.agentworkspace.runtime.REQUEST_CODE"
    }
}
